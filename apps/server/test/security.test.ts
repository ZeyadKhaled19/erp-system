import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, item, line, party, setup, type Client } from './helpers';

// Each test run provisions an in-memory PGlite database through setup().
let env: Awaited<ReturnType<typeof setup>>;
let admin: Client;
let cashier: Client;

beforeAll(async () => {
  env = await setup();
  admin = await env.login();
  const created = await env.app.inject({
    method: 'POST', url: '/api/admin/users', headers: { authorization: `Bearer ${admin.token}` },
    payload: { username: 'security-cashier', full_name: 'اختبار الصلاحيات', role_id: 'role-cashier', active: true, password: 'cash12345' },
  });
  expect(created.statusCode).toBe(200);
  const user = await env.db.one(`select id from users where username = $1`, ['security-cashier']);
  await env.db.query(`update users set warehouse_ids = $2, cashbox_ids = $3, denied_permissions = $4, extra_permissions = $5 where id = $1`, [
    user.id, ['wh-main'], ['cb-main'], ['parties.view', 'purchases.view'], ['reports.view'],
  ]);
  cashier = await env.login('security-cashier', 'cash12345', 'security-device-01');
  const results = await admin.push([
    admin.envelope(item('security-item', 'SEC-ITEM', 'صنف أمني', { sale_price: 10000 })),
    admin.envelope(party('security-supplier', 'supplier', 'SEC-SUP', 'مورد أمني')),
    admin.envelope({ type: 'master.upsert', entity: 'warehouse', id: 'security-other-warehouse', base_version: null, data: { code: 'SEC-WH', name: 'مخزن خارج النطاق', active: true } }),
    admin.envelope({ type: 'master.upsert', entity: 'cashbox', id: 'security-other-cashbox', base_version: null, data: { name: 'خزينة خارج النطاق', kind: 'cash' } }),
  ]);
  expect(results.every((r) => r.status === 'accepted')).toBe(true);
});

afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('server-side authorization boundaries', () => {
  it('filters sync pull to permissions granted to the authenticated employee', async () => {
    const createdParty = await admin.op(party('security-private-party', 'customer', 'SEC-CUS', 'عميل خاص'));
    expect(createdParty.status).toBe('accepted');
    const pulled = await cashier.get('/api/sync/pull?cursor=0');
    expect((pulled.changes.parties ?? []).some((x: any) => x.id === 'security-private-party')).toBe(false);
    expect((pulled.changes.users ?? []).some((x: any) => x.username === 'admin')).toBe(false);
  });

  it('requires the document module view permission for document details', async () => {
    const saved = await admin.op(doc({
      id: 'security-private-doc', doc_type: 'purchase_invoice', party_id: 'security-supplier', warehouse_id: 'wh-main',
      lines: [line('security-item', 1, 10000)],
    }, 'draft')); 
    expect(saved.status, JSON.stringify(saved)).toBe('accepted');
    const response = await env.app.inject({ method: 'GET', url: '/api/documents/security-private-doc', headers: cashier.headers });
    expect(response.statusCode).toBe(403);
  });

  it('does not allow a report to read a cashbox outside the employee assignment', async () => {
    const response = await env.app.inject({ method: 'GET', url: '/api/reports/cashbox/security-other-cashbox', headers: cashier.headers });
    expect(response.statusCode).toBe(403);
  });



  it('limits document reports to document types and resources the employee can access', async () => {
    const report = await cashier.get('/api/reports/documents');
    expect(report.rows.some((row: any) => row.id === 'security-private-doc')).toBe(false);
    expect(report.rows.every((row: any) => row.warehouse_name !== 'مخزن خارج النطاق')).toBe(true);
  });  it('omits journal and audit detail without their own permissions', async () => {
    const receipt = await admin.op(doc({
      doc_type: 'receipt', party_id: 'party-cash-customer', cashbox_id: 'cb-main', amount: 1000,
    }));
    expect(receipt.status).toBe('accepted');
    const details = await cashier.get(`/api/documents/${receipt.result.id}`);
    expect(details.entries).toEqual([]);
    expect(details.audit).toEqual([]);
  });


  it('redacts stock movement values without costs.view', async () => {
    const opening = await admin.op(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line('security-item', 2, 5000)] }));
    expect(opening.status).toBe('accepted');
    const result = await cashier.get('/api/reports/item/security-item?warehouse_id=wh-main');
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.every((move: any) => move.value === null)).toBe(true);
  });  it('rejects warehouse movement reports outside the employee assignment', async () => {
    const response = await env.app.inject({ method: 'GET', url: '/api/reports/warehouse-movement/security-other-warehouse', headers: cashier.headers });
    expect(response.statusCode).toBe(403);
  });
  it('rechecks warehouse assignment when a saved sales draft is posted', async () => {
    const stock = await admin.op(doc({
      doc_type: 'opening_stock', warehouse_id: 'security-other-warehouse', lines: [line('security-item', 10, 5000)],
    }));
    expect(stock.status, JSON.stringify(stock)).toBe('accepted');
    const draft = await admin.op(doc({
      id: 'security-out-of-scope-sale', doc_type: 'sale_invoice', party_id: 'party-cash-customer', cashbox_id: 'cb-main',
      warehouse_id: 'security-other-warehouse', lines: [line('security-item', 1, 10000)],
    }, 'draft')); 
    expect(draft.status, JSON.stringify(draft)).toBe('accepted');
    const posted = await cashier.op({ type: 'doc.post', id: 'security-out-of-scope-sale', base_version: draft.result.version as number });
    expect(posted.status).toBe('rejected');
    expect((await env.db.one(`select status from documents where id = $1`, ['security-out-of-scope-sale'])).status).toBe('draft');
  });

  it('requires document edit permission when applying a client conflict resolution', async () => {
    const original = await admin.op(doc({
      id: 'security-conflicted-sale', doc_type: 'sale_invoice', party_id: 'party-cash-customer', cashbox_id: 'cb-main',
      warehouse_id: 'wh-main', lines: [line('security-item', 1, 10000)], notes: 'الأصل',
    }, 'draft')); 
    expect(original.status, JSON.stringify(original)).toBe('accepted');
    const current = await admin.op({
      type: 'doc.save', action: 'draft', base_version: original.result.version as number,
      doc: (doc({ id: 'security-conflicted-sale', doc_type: 'sale_invoice', party_id: 'party-cash-customer', cashbox_id: 'cb-main', warehouse_id: 'wh-main', lines: [line('security-item', 1, 10000)], notes: 'تعديل الخادم' }) as any).doc,
    });
    expect(current.status).toBe('accepted');
    const conflict = await admin.op({
      type: 'doc.save', action: 'draft', base_version: original.result.version as number,
      doc: (doc({ id: 'security-conflicted-sale', doc_type: 'sale_invoice', party_id: 'party-cash-customer', cashbox_id: 'cb-main', warehouse_id: 'wh-main', lines: [line('security-item', 1, 10000)], notes: 'تعديل الموظف' }) as any).doc,
    });
    expect(conflict.status).toBe('conflict');
    const conflictId = conflict.result?.conflict_id as string;
    const user = await env.db.one(`select id from users where username = $1`, ['security-cashier']);
    await env.db.query(`update users set extra_permissions = $2 where id = $1`, [user.id, ['conflicts.resolve']]);
    cashier = await env.login('security-cashier', 'cash12345', 'security-device-01');
    const resolved = await cashier.op({ type: 'conflict.resolve', id: conflictId, resolution: 'apply_client' });
    expect(resolved.status).toBe('rejected');
    expect((await env.db.one(`select notes from documents where id = $1`, ['security-conflicted-sale'])).notes).toBe('تعديل الخادم');
  });
});
