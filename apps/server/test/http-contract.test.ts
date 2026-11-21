import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

/**
 * HTTP contract of the server, written against the pre-NestJS Fastify server and kept as a
 * regression guard: status codes, error bodies, the SPA fallback, CORS, downloads and which
 * routes exist in each deployment mode.
 *
 * CONTRACT_APP=<path to another app.ts> runs the same assertions against another build
 * (used during the migration to check the old server and the NestJS server answer alike).
 */
const target = process.env.CONTRACT_APP ? path.resolve(process.env.CONTRACT_APP) : '../src/app';
const { buildApp } = (await import(target)) as typeof import('../src/app');

type App = Awaited<ReturnType<typeof buildApp>>;
let db: Awaited<ReturnType<typeof openDb>>;
let app: App;
let vendor: App;
let token = '';
const dev = 'contract-device-01';
const auth = () => ({ authorization: `Bearer ${token}`, 'x-device-id': dev });

beforeAll(async () => {
  db = await openDb({ memory: true });
  const backupDir = await mkdtemp(path.join(os.tmpdir(), 'erp-contract-'));
  await migrate(db, { backupDir });
  await seed(db, { adminPassword: 'admin123' });
  const webDist = await mkdtemp(path.join(os.tmpdir(), 'erp-web-'));
  await mkdir(path.join(webDist, 'assets'));
  await writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(path.join(webDist, 'assets', 'app-123.js'), 'console.log(1)');
  app = await buildApp({ db, jwtSecret: 'contract-secret', backupDir, webDist });
  vendor = await buildApp({ db, jwtSecret: 'contract-secret', backupDir, vendor: true });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: dev } });
  token = r.json().token;
});

afterAll(async () => {
  await app.close();
  await vendor.close();
  await db.close();
});

describe('HTTP contract', () => {
  it('health and brand are public', async () => {
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ ok: true, db: 'pglite' });
    const b = await app.inject({ method: 'GET', url: '/api/brand' });
    expect(b.statusCode).toBe(200);
    expect(Object.keys(b.json()).sort()).toEqual(['company_name', 'logo', 'system_name']);
  });

  it('POST routes answer 200, not 201', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123', device_id: dev } });
    expect(login.statusCode).toBe(200);
    expect(Object.keys(login.json()).sort()).toEqual(['token', 'user']);
    const push = await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth(), payload: { ops: [] } });
    expect(push.statusCode).toBe(200);
    expect(push.json()).toEqual({ results: [] });
  });

  it('auth and permission errors keep their status and body', async () => {
    const none = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toEqual({ error: 'سجّل الدخول أولًا', code: 'auth' });
    const bad = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'انتهت الجلسة؛ سجّل الدخول مرة أخرى', code: 'auth' });
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong-pass', device_id: dev } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة', code: 'auth' });

    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(), payload: { username: 'contractcashier', full_name: 'كاشير', role_id: 'role-cashier', password: 'secret12' } });
    const c = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'contractcashier', password: 'secret12', device_id: 'contract-device-02' } });
    const forbidden = await app.inject({ method: 'GET', url: '/api/reports/trial-balance', headers: { authorization: `Bearer ${c.json().token}` } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: 'ليس لديك صلاحية', code: 'forbidden' });
  });

  it('validation errors are 400 with the zod messages joined', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(), payload: { username: 'x', full_name: 'اسم', role_id: 'role-cashier' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'اسم المستخدم حرفان على الأقل' });
    const s = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth(), payload: { nope: 1 } });
    expect(s.statusCode).toBe(400);
    expect(s.json()).toEqual({ error: 'إعداد غير معروف: nope', code: 'validation' });
  });

  it('broken JSON is answered like before (500, generic message)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'خطأ في الخادم' });
  });

  it('not found: JSON for /api and files, index.html for app paths', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/nothing-here', headers: auth() });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'غير موجود' });
    const asset = await app.inject({ method: 'GET', url: '/assets/old-999.js' });
    expect(asset.statusCode).toBe(404);
    const page = await app.inject({ method: 'GET', url: '/pos' });
    expect(page.statusCode).toBe(200);
    // The pre-NestJS server sent 'public, max-age=0' here (with @fastify/static 8 the plugin default won over
    // the intended no-cache). Both make the browser revalidate index.html; with @fastify/static 10 the
    // intended no-cache applies. Recorded in docs/nestjs-migration.md.
    expect(['no-cache', 'public, max-age=0']).toContain(page.headers['cache-control']);
    expect(page.body).toContain('<title>app</title>');
    const js = await app.inject({ method: 'GET', url: '/assets/app-123.js' });
    expect(js.statusCode).toBe(200);
    // Hashed assets are cached long-term. The pre-NestJS server meant to but its header was overridden
    // by the plugin default (latent bug, recorded in docs/nestjs-migration.md); Vercel already sent it.
    expect(js.headers['cache-control']).toBe(process.env.CONTRACT_APP ? 'public, max-age=0' : 'public, max-age=31536000, immutable');
  });

  it('CORS reflects the origin', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://192.168.1.20:4000' } });
    expect(r.headers['access-control-allow-origin']).toBe('http://192.168.1.20:4000');
  });

  it('backup download is a gzipped JSON attachment', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/backup-download', headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="erp-backup-.*-download\.json"$/);
    expect(JSON.parse(gunzipSync(r.rawPayload).toString('utf8')).format).toBe('erp-backup');
  });

  it('license routes: status everywhere, vendor routes only on the vendor site', async () => {
    const lic = await app.inject({ method: 'GET', url: '/api/license' });
    expect(lic.statusCode).toBe(200);
    expect(lic.json()).toMatchObject({ gated: false, vendor: false, license: null });
    // a plain server refuses registration before looking at the body
    const reg = await app.inject({ method: 'POST', url: '/api/license/register', payload: {} });
    expect(reg.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/public/contact' })).statusCode).toBe(404);
    const contact = await vendor.inject({ method: 'GET', url: '/api/public/contact' });
    expect(contact.statusCode).toBe(200);
    expect(contact.json().contact.phone).toBeTruthy();
  });

  it('purchase invoice amendment helper lists linked payments', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/documents/nope/amendment', headers: auth() });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'الفاتورة غير موجودة', code: 'not_found' });

    const env = (op: unknown, seq: number) => ({ op_id: crypto.randomUUID(), seq, created_at: new Date().toISOString(), op });
    const line = { id: crypto.randomUUID(), item_id: 'contract-item', unit_name: 'قطعة', unit_factor: 1000, qty: 2000, price: 5000, discount: 0, tax_rate_bp: 0, serials: [] };
    const base = { journal_lines: [], paid: 0, amount: 0, discount: 0, date: '2026-11-01' };
    const ops = [
      env({ type: 'master.upsert', entity: 'item', id: 'contract-item', base_version: null, data: { code: 'CT-1', name: 'صنف العقد', base_unit: 'قطعة', sale_price: 9000 } }, 0),
      env({ type: 'master.upsert', entity: 'party', id: 'contract-supplier', base_version: null, data: { kind: 'supplier', code: 'CTS-1', name: 'مورد العقد' } }, 1),
      env({ type: 'doc.save', action: 'post', base_version: null, doc: { ...base, id: 'contract-purchase', doc_type: 'purchase_invoice', party_id: 'contract-supplier', warehouse_id: 'wh-main', payment_type: 'credit', lines: [line] } }, 2),
      env({ type: 'doc.save', action: 'post', base_version: null, doc: { ...base, id: 'contract-payment', doc_type: 'payment', party_id: 'contract-supplier', cashbox_id: 'cb-main', amount: 3000, ref_doc_id: 'contract-purchase', lines: [] } }, 3),
    ];
    const pushed = await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth(), payload: { ops } });
    expect(pushed.json().results.map((r: any) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);

    const r = await app.inject({ method: 'GET', url: '/api/documents/contract-purchase/amendment', headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().payment_allocations).toEqual([
      expect.objectContaining({ source_id: 'contract-payment', total: 3000, current_amount: 3000, max_amount: 3000 }),
    ]);
    const wrongType = await app.inject({ method: 'GET', url: '/api/documents/contract-payment/amendment', headers: auth() });
    expect(wrongType.statusCode).toBe(409);
  });

  it('query parameters still filter reports', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/reports/documents?from=2026-01-01&to=2026-01-31&types=sale_invoice', headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rows: [], totals: { count: 0 } });
  });
});
