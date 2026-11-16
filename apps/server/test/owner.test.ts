import crypto from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import type { LicenseInput } from '../src/license';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

const PRIV = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
let db: Awaited<ReturnType<typeof openDb>>;
let vendor: Awaited<ReturnType<typeof buildApp>>;
let shop: Awaited<ReturnType<typeof buildApp>>;
let h: Record<string, string>;
const input: LicenseInput = { machineId: 'ABCD-0000-0000-0002', trialStart: new Date().toISOString() };

beforeAll(async () => {
  db = await openDb({ memory: true });
  const backupDir = await mkdtemp(path.join(os.tmpdir(), 'erp-own-'));
  await migrate(db, { backupDir });
  await seed(db, { adminPassword: 'admin123' });
  vendor = await buildApp({ db, jwtSecret: 'test-secret', backupDir, vendor: true, licensePrivateKey: PRIV, downloadUrl: 'https://example.test/x.exe' });
  shop = await buildApp({ db, jwtSecret: 'test-secret', backupDir, license: { get: () => input, activate: () => {} } });
  const token = (await vendor.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-o-0001', new_password: 'Strong-Pass-2026' } })).json().token;
  h = { authorization: `Bearer ${token}`, 'x-device-id': 'device-o-0001' };
});
afterAll(async () => {
  await vendor.close();
  await shop.close();
  await db.close();
});

describe('owner dashboard', () => {
  it('contact info: default number, the owner edits it, and the public page reads it', async () => {
    expect((await vendor.inject({ method: 'GET', url: '/api/public/contact' })).json().contact).toMatchObject({ phone: '01279792522', whatsapp: '01279792522' });
    const bad = await vendor.inject({ method: 'POST', url: '/api/admin/vendor-contact', headers: h, payload: { phone: '0100', whatsapp: '', facebook: 'facebook.com/x', youtube: '' } });
    expect(bad.statusCode).toBe(400);
    const ok = await vendor.inject({ method: 'POST', url: '/api/admin/vendor-contact', headers: h, payload: { phone: '01000000001', whatsapp: '01000000002', facebook: 'https://facebook.com/eco', youtube: '' } });
    expect(ok.statusCode).toBe(200);
    expect((await vendor.inject({ method: 'GET', url: '/api/license' })).json().contact).toMatchObject({ phone: '01000000001', facebook: 'https://facebook.com/eco' });
    // في برنامج الويندوز: آخر بيانات جت من الموقع، أو الافتراضي
    expect((await shop.inject({ method: 'GET', url: '/api/license' })).json().contact.phone).toBe('01279792522');
    input.contact = { phone: '01000000001', whatsapp: '01000000002', facebook: '', youtube: '' };
    expect((await shop.inject({ method: 'GET', url: '/api/license' })).json().contact.whatsapp).toBe('01000000002');
  });

  it('a Windows app checks in (no business data) and gets the contact info back', async () => {
    const r = await vendor.inject({ method: 'POST', url: '/api/public/ping', payload: { machine_id: 'abcd-0000-0000-0002', company_name: 'محل النور', version: '1.0.13', status: 'trial', days_left: 2 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().contact.phone).toBe('01000000001');
    const row = await db.one(`select * from installations where machine_id = 'ABCD-0000-0000-0002'`);
    expect(row).toMatchObject({ company_name: 'محل النور', version: '1.0.13', status: 'trial', days_left: 2 });
    expect((await vendor.inject({ method: 'POST', url: '/api/public/ping', payload: { machine_id: 'xyz' } })).statusCode).toBe(400);
  });

  it('dashboard numbers: signups, conversion, revenue, devices and who to call', async () => {
    await vendor.inject({ method: 'POST', url: '/api/public/trial-signup', payload: { name: 'سعيد', phone: '01011111111', business: 'محل سعيد', governorate: 'الجيزة' } });
    await vendor.inject({ method: 'POST', url: '/api/public/trial-signup', payload: { name: 'منى', phone: '01022222222', business: 'محل منى', governorate: 'القاهرة' } });
    const lic = await vendor.inject({ method: 'POST', url: '/api/admin/licenses', headers: h, payload: { machine_id: 'ABCD-0000-0000-0002', customer: 'محل النور', plan: 'month', amount: 150000, phone: '01033333333' } });
    expect(lic.statusCode).toBe(200);
    const d = (await vendor.inject({ method: 'GET', url: '/api/admin/owner-dashboard', headers: h })).json();
    expect(d.signups).toMatchObject({ today: 2, total: 2 });
    expect(d.revenue.month).toBe(150000);
    expect(d.licenses).toMatchObject({ active: 1, expiring: 1 });
    expect(d.devices).toMatchObject({ total: 1, trial: 1 });
    expect(d.newSignups.length).toBe(2);
    expect(d.endingTrials[0].company_name).toBe('محل النور');
    expect(d.expiringLicenses[0].customer).toBe('محل النور');
    expect(d.installations[0].customer).toBe('محل النور');
    expect(d.weekly.length).toBe(12);
    expect(d.weekly.at(-1)).toMatchObject({ signups: 2, activations: 1 });
    expect((await vendor.inject({ method: 'GET', url: '/api/admin/owner-dashboard' })).statusCode).toBe(401);
  });
});
