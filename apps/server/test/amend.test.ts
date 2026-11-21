import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrityCheck } from '../src/integrity';
import { doc, item, line, party, setup, type Client } from './helpers';

/**
 * تعديل فاتورة مرحّلة (doc.amend): الفاتورة البديلة بتاخد نفس الرقم، والأصلية بتتلغي بقيد عكسي وتتربط بيها،
 * وسندات الصرف المربوطة بتتنقل. الترتيب حسب اتجاه المخزون، والحالات اللي محتاجة مراجعة بتترفض بسبب واضح.
 */
let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const ITEM = 'amend-item';
const LAST = 'amend-last-unit';
const SUPPLIER = 'amend-supplier';
const OTHER_SUPPLIER = 'amend-other-supplier';
const CUSTOMER = 'amend-customer';

const qty = async (id: string) => (await env.db.one(`select qty from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [id]))?.qty ?? 0;
const balance = async (id: string) => (await env.db.one(`select balance from parties where id = $1`, [id])).balance;
const row = (id: string) => env.db.one(`select * from documents where id = $1`, [id]);
/** نفس شكل اللي الواجهة بتبعته: فاتورة كاملة بمعرف جديد وسطور جديدة */
const amendOp = (originalId: string, d: Record<string, any>, extra: Record<string, any> = {}) =>
  ({ type: 'doc.amend', id: originalId, doc: (doc(d) as any).doc, reason: 'تصحيح الكمية', ...extra }) as any;
const purchase = (lines: any[], extra: Record<string, any> = {}) => ({ doc_type: 'purchase_invoice', party_id: SUPPLIER, warehouse_id: 'wh-main', payment_type: 'credit', lines, ...extra });

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(ITEM, 'AM-1', 'صنف التعديل', { sale_price: 10000 })),
    A.envelope(item(LAST, 'AM-2', 'آخر قطعة', { sale_price: 5000 })),
    A.envelope(party(SUPPLIER, 'supplier', 'AMS-1', 'مورد التعديل')),
    A.envelope(party(OTHER_SUPPLIER, 'supplier', 'AMS-2', 'مورد تاني')),
    A.envelope(party(CUSTOMER, 'customer', 'AMC-1', 'عميل التعديل')),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(LAST, 1, 2000)] })),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
});

afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('editing a posted invoice (doc.amend)', () => {
  it('a purchase invoice keeps its number; the original is cancelled, linked and reversed', async () => {
    const p = await A.op(doc(purchase([line(ITEM, 3, 4000)])));
    expect(p.status).toBe('accepted');
    expect(await qty(ITEM)).toBe(3000);
    expect(await balance(SUPPLIER)).toBe(12000);

    const r = await A.op(amendOp(p.result.id, purchase([line(ITEM, 2, 4000)])));
    expect(r.status).toBe('accepted');
    expect(r.result.number).toBe(p.result.number);
    const original = await row(p.result.id);
    expect(original).toMatchObject({ status: 'cancelled', amended_to_id: r.result.id, number: null });
    expect(await row(r.result.id)).toMatchObject({ status: 'posted', amended_from_id: p.result.id, total: 8000 });
    expect(await qty(ITEM)).toBe(2000);
    expect(await balance(SUPPLIER)).toBe(8000);
    expect((await integrityCheck(env.db)).ok).toBe(true);
  });

  it('moves a linked supplier payment to the corrected invoice', async () => {
    const p = await A.op(doc(purchase([line(ITEM, 2, 5000)])));
    const pay = await A.op(doc({ doc_type: 'payment', party_id: SUPPLIER, cashbox_id: 'cb-main', amount: 4000, ref_doc_id: p.result.id }));
    expect(pay.status).toBe('accepted');
    const r = await A.op(amendOp(p.result.id, purchase([line(ITEM, 3, 5000)]), { payment_allocations: [{ source_id: pay.result.id, amount: 4000 }] }));
    expect(r.status).toBe('accepted');
    expect(await row(r.result.id)).toMatchObject({ total: 15000, paid: 4000 });
    const alloc = await env.db.one(`select coalesce(sum(amount), 0)::bigint as a from allocations where source_id = $1 and invoice_id = $2 and not reversed`, [pay.result.id, r.result.id]);
    expect(alloc.a).toBe(4000);
    expect((await integrityCheck(env.db)).ok).toBe(true);
  });

  it('a purchase whose goods were partly sold can still be corrected (the new one posts first)', async () => {
    const p = await A.op(doc(purchase([line(ITEM, 5, 4000)])));
    const before = await qty(ITEM);
    const s = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, before / 1000 - 1, 10000)] }));
    expect(s.status).toBe('accepted');
    const r = await A.op(amendOp(p.result.id, purchase([line(ITEM, 4, 4000)])));
    expect(r.status).toBe('accepted');
    expect(await qty(ITEM)).toBe(0);
  });

  it('a sale of the last unit can be corrected (the original is reversed first)', async () => {
    const s = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(LAST, 1, 5000)] }));
    expect(s.status).toBe('accepted');
    expect(await qty(LAST)).toBe(0);
    const r = await A.op(amendOp(s.result.id, { doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(LAST, 1, 4500)] }));
    expect(r.status).toBe('accepted');
    expect(r.result.number).toBe(s.result.number);
    expect(await qty(LAST)).toBe(0);
    expect(await balance(CUSTOMER)).toBe(4500);
  });

  it('rejects (no endless retry) when the corrected invoice would need review, and changes nothing', async () => {
    const s = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(LAST, 1, 4500)] }, 'draft'));
    expect(s.status).toBe('accepted');
    const p = await A.op(doc(purchase([line(LAST, 1, 2000)])));
    const sale = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(LAST, 1, 4500)] }));
    expect(sale.status).toBe('accepted');
    void p;
    const balBefore = await balance(CUSTOMER);
    const r = await A.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(LAST, 50, 4500)] }));
    expect(r.status).toBe('rejected');
    expect(r.retry).toBeUndefined();
    expect(r.message).toContain('الأصلية فضلت زي ما هي');
    expect((await row(sale.result.id)).status).toBe('posted');
    expect(await balance(CUSTOMER)).toBe(balBefore);
  });

  it('refuses another supplier', async () => {
    const p = await A.op(doc(purchase([line(ITEM, 1, 4000)])));
    const r = await A.op(amendOp(p.result.id, purchase([line(ITEM, 1, 4000)], { party_id: OTHER_SUPPLIER })));
    expect(r.status).toBe('rejected');
    expect((await row(p.result.id)).status).toBe('posted');
  });

  it('needs the cancel permission as well as edit and post', async () => {
    const role = await env.app.inject({ method: 'POST', url: '/api/admin/roles', headers: A.headers, payload: { name: 'مشتريات بدون إلغاء', permissions: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.post', 'items.view', 'parties.view'] } });
    expect(role.statusCode).toBe(200);
    const u = await env.app.inject({ method: 'POST', url: '/api/admin/users', headers: A.headers, payload: { username: 'amendbuyer', full_name: 'مشتريات', role_id: role.json().id, password: 'secret12' } });
    expect(u.statusCode).toBe(200);
    const B = await env.login('amendbuyer', 'secret12', 'device-amend-buyer');
    const p = await A.op(doc(purchase([line(ITEM, 1, 4000)])));
    const r = await B.op(amendOp(p.result.id, purchase([line(ITEM, 2, 4000)])));
    expect(r.status).toBe('rejected');
    expect((await row(p.result.id)).status).toBe('posted');
    const info = await env.app.inject({ method: 'GET', url: `/api/documents/${p.result.id}/amendment`, headers: B.headers });
    expect(info.statusCode).toBe(403);
    void uuid;
  });
});
