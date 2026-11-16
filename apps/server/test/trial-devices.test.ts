import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import type { LicenseInput } from '../src/license';
import { normalizePhone } from '../src/licensing';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

type App = Awaited<ReturnType<typeof buildApp>>;
const DAY = 86400000;
const apps: App[] = [];
const dbs: Awaited<ReturnType<typeof openDb>>[] = [];
let vendorUrl = '';
let vendorDb: Awaited<ReturnType<typeof openDb>>;

async function freshDb() {
  const db = await openDb({ memory: true });
  await migrate(db, { backupDir: await mkdtemp(path.join(os.tmpdir(), 'erp-td-')) });
  await seed(db, { adminPassword: 'admin123' });
  dbs.push(db);
  return db;
}
/** خادم زي اللي جوه برنامج الويندوز، لجهاز معين */
async function shopFor(machineId: string, db?: Awaited<ReturnType<typeof openDb>>, trialStart = new Date().toISOString()) {
  const input: LicenseInput = { machineId, trialStart, registered: false };
  const saved: { start?: string; phone?: string } = {};
  const app = await buildApp({
    db: db ?? (await freshDb()),
    jwtSecret: 'test-secret',
    backupDir: os.tmpdir(),
    vendorUrl,
    license: { get: () => input, activate: () => {}, register: (s, p) => { input.trialStart = s; input.registered = true; saved.start = s; saved.phone = p; } },
  });
  apps.push(app);
  return { app, input, saved };
}
const register = (app: App, phone = '01012345678') =>
  app.inject({ method: 'POST', url: '/api/license/register', payload: { phone, business: 'محل التجربة', governorate: 'القاهرة' } });

beforeAll(async () => {
  vendorDb = await freshDb();
  const vendor = await buildApp({ db: vendorDb, jwtSecret: 'test-secret', backupDir: os.tmpdir(), vendor: true });
  apps.push(vendor);
  await vendor.listen({ port: 0, host: '127.0.0.1' });
  const addr = vendor.server.address();
  vendorUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  for (const a of apps) await a.close();
  for (const d of dbs) await d.close();
});

describe('one trial per phone number', () => {
  it('normalises Egyptian phone numbers', () => {
    expect(normalizePhone('+20 101 234 5678')).toBe('01012345678');
    expect(normalizePhone('00201012345678')).toBe('01012345678');
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
  });

  it('first run: locked until the phone number is registered online, then 7 days', async () => {
    const { app, saved } = await shopFor('AAAA-0000-0000-0001');
    expect((await app.inject({ method: 'GET', url: '/api/license' })).json().license.status).toBe('unregistered');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-t-0001' } })).statusCode).toBe(402);
    expect((await app.inject({ method: 'POST', url: '/api/license/register', payload: { phone: '0101', business: 'محل', governorate: 'القاهرة' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/license/register', payload: { phone: '01012345678', business: 'محل', governorate: 'مش محافظة' } })).statusCode).toBe(400);
    const r = await register(app);
    expect(r.statusCode).toBe(200);
    expect(r.json().license).toMatchObject({ status: 'trial', daysLeft: 7 });
    expect(saved.phone).toBe('01012345678');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: 'device-t-0001' } })).statusCode).toBe(200);
    // اتسجل عند صاحب السيستم، وظهر في قايمة اللي سجلوا
    expect(await vendorDb.one(`select phone, governorate from trial_devices where machine_id = 'AAAA-0000-0000-0001'`)).toMatchObject({ phone: '01012345678', governorate: 'القاهرة' });
    expect(await vendorDb.one(`select 1 as ok from trial_signups where phone = '01012345678'`)).toBeTruthy();
  });

  it('the same phone on another device continues the same trial, and is locked once it ended', async () => {
    const second = await shopFor('AAAA-0000-0000-0002');
    expect((await register(second.app, '+20 10 1234 5678')).json().license).toMatchObject({ status: 'trial' });
    const first = await vendorDb.one<{ trial_start: any }>(`select trial_start from trial_devices where machine_id = 'AAAA-0000-0000-0001'`);
    expect(new Date(second.saved.start!).getTime()).toBe(new Date(first!.trial_start).getTime());

    // أول تجربة للرقم ده بدأت من 8 أيام: أي جهاز جديد بنفس الرقم يبقى مقفول
    await vendorDb.query(`update trial_devices set trial_start = now() - interval '8 days' where phone = '01012345678'`);
    const third = await shopFor('AAAA-0000-0000-0003');
    const r = await register(third.app);
    expect(r.statusCode).toBe(200);
    expect(r.json().license).toMatchObject({ status: 'expired', reason: 'trial' });
    // رقم تاني = تجربة جديدة
    const fourth = await shopFor('AAAA-0000-0000-0004');
    expect((await register(fourth.app, '01099999999')).json().license).toMatchObject({ status: 'trial', daysLeft: 7 });
  });

  it('without internet the trial can not start', async () => {
    const { app, input } = await shopFor('AAAA-0000-0000-0005');
    const off = await buildApp({ db: await freshDb(), jwtSecret: 'test-secret', backupDir: os.tmpdir(), vendorUrl: 'http://127.0.0.1:1', license: { get: () => input, activate: () => {}, register: () => {} } });
    apps.push(off);
    const r = await register(off);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('النت');
    expect(app).toBeTruthy();
  });
});

describe('trial start saved inside the data', () => {
  it('moving the data (same users and passwords) to a new device keeps the old trial start', async () => {
    const db = await freshDb();
    // البيانات دي جاية من جهاز تجربته بدأت من 10 أيام
    await db.query(`insert into settings (key, value) values ('trial_started_at', $1)`, [JSON.stringify(new Date(Date.now() - 10 * DAY).toISOString())]);
    const { app, input } = await shopFor('AAAA-0000-0000-0006', db);
    input.registered = true; // الجهاز الجديد اتسجل برقم تاني، بس البيانات قديمة
    await new Promise((r) => setTimeout(r, 300));
    expect((await app.inject({ method: 'GET', url: '/api/license' })).json().license).toMatchObject({ status: 'expired', reason: 'trial' });
  });

  it('a new device writes its trial start into the data', async () => {
    const db = await freshDb();
    const start = new Date(Date.now() - 2 * DAY).toISOString();
    const { app, input } = await shopFor('AAAA-0000-0000-0007', db, start);
    input.registered = true;
    await new Promise((r) => setTimeout(r, 300));
    const row = await db.one<{ value: any }>(`select value from settings where key = 'trial_started_at'`);
    expect(row?.value).toBe(start);
    expect((await app.inject({ method: 'GET', url: '/api/license' })).json().license).toMatchObject({ status: 'trial', daysLeft: 5 });
  });
});
