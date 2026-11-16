import crypto from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { LICENSE_PUBLIC_KEY, type LicenseInput } from '../src/license';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

// خادم المحل بيتأكد من الأكواد بالمفتاح العام المدمج بس، فهنا بنختبر القفل والرفض وإصدار الأكواد،
// والتوقيع والتحقق نفسهم متختبرين في license.test.ts بمفتاح مؤقت.
const kp = crypto.generateKeyPairSync('ed25519');
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

let db: Awaited<ReturnType<typeof openDb>>;
let shop: Awaited<ReturnType<typeof buildApp>>;
let vendor: Awaited<ReturnType<typeof buildApp>>;
const input: LicenseInput = { machineId: 'ABCD-0000-0000-0001', trialStart: new Date(Date.now() - 8 * 86400000).toISOString() };
let saved: string | null = null;
let trialShop: Awaited<ReturnType<typeof buildApp>>;
const extraDbs: Awaited<ReturnType<typeof openDb>>[] = [];

beforeAll(async () => {
  db = await openDb({ memory: true });
  const backupDir = await mkdtemp(path.join(os.tmpdir(), 'erp-lic-'));
  await migrate(db, { backupDir });
  await seed(db, { adminPassword: 'admin123' });
  shop = await buildApp({ db, jwtSecret: 'test-secret', backupDir, license: { get: () => input, activate: (c) => { saved = c; } } });
  vendor = await buildApp({ db, jwtSecret: 'test-secret', backupDir, vendor: true, licensePrivateKey: PRIV, downloadUrl: 'https://example.test/ERP-Setup.exe' });
});
afterAll(async () => {
  await trialShop?.close();
  for (const d of extraDbs) await d.close();
  await shop.close();
  await vendor.close();
  await db.close();
});

describe('licensing', () => {
  it('after the 7-day trial the shop server refuses everything except the license and brand endpoints', async () => {
    const st = (await shop.inject({ method: 'GET', url: '/api/license' })).json();
    expect(st.license).toMatchObject({ status: 'expired', reason: 'trial', machineId: 'ABCD-0000-0000-0001' });
    const login = await shop.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-x-0001' } });
    expect(login.statusCode).toBe(402);
    expect(login.json()).toMatchObject({ code: 'license' });
    expect((await shop.inject({ method: 'GET', url: '/api/brand' })).statusCode).toBe(200);
    // كود غلط أو لجهاز تاني ما يفتحش، وما يتحفظش
    const bad = await shop.inject({ method: 'POST', url: '/api/license/activate', payload: { code: 'ECO1-xxxxxxxxxxxx.yyyy' } });
    expect(bad.statusCode).toBe(400);
    expect(saved).toBeNull();
    expect(LICENSE_PUBLIC_KEY.length).toBeGreaterThan(40);
  });

  it('during the trial everything works', async () => {
    // جهاز جديد ببيانات جديدة (تاريخ التجربة بيتحفظ جوه البيانات، فلازم قاعدة بيانات تانية)
    const db2 = await openDb({ memory: true });
    await migrate(db2, { backupDir: os.tmpdir() });
    await seed(db2, { adminPassword: 'admin123' });
    const fresh: LicenseInput = { machineId: 'ABCD-0000-0000-0009', trialStart: new Date().toISOString() };
    trialShop = await buildApp({ db: db2, jwtSecret: 'test-secret', backupDir: os.tmpdir(), license: { get: () => fresh, activate: () => {} } });
    extraDbs.push(db2);
    const login = await trialShop.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-x-0001' } });
    expect(login.statusCode).toBe(200);
    expect((await trialShop.inject({ method: 'GET', url: '/api/license' })).json().license).toMatchObject({ status: 'trial', daysLeft: 7 });
  });

  it('vendor site: trial signup (public), then the owner sees it and issues a code for the machine', async () => {
    const s = await vendor.inject({ method: 'POST', url: '/api/public/trial-signup', payload: { name: 'أحمد علي', phone: '01012345678', business: 'محل النور', activity: 'قطع غيار', governorate: 'القاهرة' } });
    expect(s.statusCode).toBe(200);
    expect(s.json().download_url).toBe('https://example.test/ERP-Setup.exe');
    // خانة الفخ المخفية للبرامج الآلية
    expect((await vendor.inject({ method: 'POST', url: '/api/public/trial-signup', payload: { name: 'bot', phone: '01012345678', business: 'x x', governorate: 'القاهرة', website: 'spam' } })).statusCode).toBe(400);
    // صفحة التراخيص محتاجة دخول وصلاحية
    expect((await vendor.inject({ method: 'GET', url: '/api/admin/licensing' })).statusCode).toBe(401);
    const token = (await vendor.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-v-0001' } })).json().token;
    const h = { authorization: `Bearer ${token}`, 'x-device-id': 'device-v-0001' };
    const list = (await vendor.inject({ method: 'GET', url: '/api/admin/licensing', headers: h })).json();
    expect(list.canIssue).toBe(true);
    const signup = list.signups.find((x: any) => x.business === 'محل النور');
    expect(signup).toBeTruthy();
    const bad = await vendor.inject({ method: 'POST', url: '/api/admin/licenses', headers: h, payload: { machine_id: '123', customer: 'محل النور', plan: 'year' } });
    expect(bad.statusCode).toBe(400);
    const r = await vendor.inject({ method: 'POST', url: '/api/admin/licenses', headers: h, payload: { machine_id: 'abcd 0000 0000 0001', customer: 'محل النور', plan: 'year', signup_id: signup.id } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ machine_id: 'ABCD-0000-0000-0001' });
    expect(r.json().code.startsWith('ECO1-')).toBe(true);
    const after = (await vendor.inject({ method: 'GET', url: '/api/admin/licensing', headers: h })).json();
    expect(after.licenses.length).toBe(1);
    expect(after.signups.find((x: any) => x.id === signup.id).status).toBe('activated');
  });

  it('a normal (non-vendor, non-desktop) server has no signup page and no lock', async () => {
    const st = (await trialShop.inject({ method: 'POST', url: '/api/public/trial-signup', payload: {} })).statusCode;
    expect(st).toBe(404);
  });
});
