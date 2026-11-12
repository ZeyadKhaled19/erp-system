import { resolveHome } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
let C: Client;

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  // مستخدم كاشير للاختبار
  const r = await env.app.inject({
    method: 'POST', url: '/api/admin/users', headers: { authorization: `Bearer ${A.token}` },
    payload: { username: 'cashier1', full_name: 'كاشير تجربة', role_id: 'role-cashier', active: true, password: 'cash12345' },
  });
  expect(r.statusCode).toBe(200);
  C = await env.login('cashier1', 'cash12345', 'device-C-0001');
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('role-based home pages', () => {
  it('lets only user managers set a role start page, and validates it', async () => {
    const post = (c: Client, payload: any): Promise<any> => env.app.inject({ method: 'POST', url: '/api/admin/role-home', headers: { authorization: `Bearer ${c.token}` }, payload });
    expect((await post(C, { role_id: 'role-cashier', workspace: 'dashboard' })).statusCode).toBe(403);
    expect((await post(A, { role_id: 'role-cashier', workspace: 'bogus' })).statusCode).toBe(400);
    expect((await post(A, { role_id: 'no-such-role', workspace: 'pos' })).statusCode).toBe(400);
    const ok = await post(A, { role_id: 'role-accountant', workspace: 'invoices' });
    expect(ok.statusCode).toBe(200);
    const row = await env.db.one(`select value from settings where key = 'role_home_pages'`);
    const map = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    expect(map['role-accountant']).toBe('invoices');
    // إزالة الإعداد يرجع للافتراضي
    await post(A, { role_id: 'role-accountant', workspace: null });
    const row2 = await env.db.one(`select value from settings where key = 'role_home_pages'`);
    const map2 = typeof row2.value === 'string' ? JSON.parse(row2.value) : row2.value;
    expect(map2['role-accountant']).toBeUndefined();
  });

  it('hides dashboard figures the user is not allowed to see', async () => {
    const d = await C.get('/api/reports/dashboard');
    expect(d.month_gross_profit).toBeNull();
    expect(d.stock_value).toBeNull();
    expect(d.payables).not.toBeUndefined();
    const full = await A.get('/api/reports/dashboard');
    expect(typeof full.stock_value).toBe('number');
    expect(typeof full.month_gross_profit).toBe('number');
  });

  it('resolves home: valid preference, then role default, then first permitted', () => {
    const cashier = ['sales.view', 'sales.create', 'treasury.shift', 'inventory.view', 'items.view'];
    expect(resolveHome({ perms: cashier, roleId: 'role-cashier' }).id).toBe('pos');
    expect(resolveHome({ perms: cashier, roleId: 'role-cashier', preference: 'inventory' }).id).toBe('inventory');
    // تفضيل لم يعد مسموحًا (فقد الصلاحية) يُتجاهل
    expect(resolveHome({ perms: cashier, roleId: 'role-cashier', preference: 'accounting' }).id).toBe('pos');
    // إعداد المدير للدور يسبق الافتراضي
    expect(resolveHome({ perms: cashier, roleId: 'role-cashier', roleHomes: { 'role-cashier': 'sales' } }).id).toBe('sales');
    // إعداد دور غير مسموح لصلاحياته الحالية يُتجاهل
    expect(resolveHome({ perms: ['sales.view'], roleId: 'role-cashier', roleHomes: { 'role-cashier': 'pos' } }).id).toBe('sales');
    // بلا أي صلاحية: لوحة الإدارة (تعرض فقط ما يسمح به)
    expect(resolveHome({ perms: [], roleId: 'custom' }).id).toBe('dashboard');
    expect(resolveHome({ perms: ['*'], roleId: 'role-admin' }).id).toBe('dashboard');
    expect(resolveHome({ perms: ['items.view', 'inventory.view', 'inventory.create'], roleId: 'custom' }).id).toBe('inventory');
  });
});
