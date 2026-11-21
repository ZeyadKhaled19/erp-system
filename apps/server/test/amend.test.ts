import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrityCheck } from '../src/integrity';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const ITEM = 'amend-item';
const LAST = 'amend-last-unit';
const CUSTOMER = 'amend-customer';
const OTHER = 'amend-other-customer';

const qty = async (id: string) => (await env.db.one(`select qty from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [id]))?.qty ?? 0;
const balance = async (id: string) => (await env.db.one(`select balance from parties where id = $1`, [id])).balance;
const cash = async () => (await env.db.one(`select balance from cashboxes where id = 'cb-main'`)).balance;
const row = (id: string) => env.db.one(`select * from documents where id = $1`, [id]);

/** نفس الفاتورة بمعرف جديد ومعرفات سطور ودفعات جديدة (زي ما الواجهة بتبعتها) */
function amendOp(originalId: string, d: Record<string, any>, reason = 'تصحيح الكمية') {
  return { type: 'doc.amend', id: originalId, reason, doc: (doc(d) as any).doc } as any;
}

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(ITEM, 'AM-1', 'صنف التعديل', { sale_price: 10000 })),
    A.envelope(item(LAST, 'AM-2', 'آخر قطعة', { sale_price: 5000 })),
    A.envelope(party(CUSTOMER, 'customer', 'AMC-1', 'عميل التعديل')),
    A.envelope(party(OTHER, 'customer', 'AMC-2', 'عميل تاني')),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(ITEM, 10, 4000), line(LAST, 1, 2000)] })),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
});

afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('editing a posted invoice (doc.amend)', () => {
  it('cancels the original, posts the corrected invoice with a new number, and links them', async () => {
    const sale = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 3, 10000)] }));
    expect(sale.status).toBe('accepted');
    expect(await qty(ITEM)).toBe(7000);
    expect(await balance(CUSTOMER)).toBe(30000);

    const r = await A.op(amendOp(sale.result.id, {
      doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', lines: [line(ITEM, 2, 10000)],
      payments: [{ id: uuid(), cashbox_id: 'cb-main', amount: 5000 }],
    }));
    expect(r.status).toBe('accepted');
    expect(r.result.number).not.toBe(sale.result.number);

    const original = await row(sale.result.id);
    const amended = await row(r.result.id);
    expect(original.status).toBe('cancelled');
    expect(original.amended_to_id).toBe(r.result.id);
    expect(amended).toMatchObject({ status: 'posted', amended_from_id: sale.result.id, total: 20000, paid: 5000 });
    expect(await qty(ITEM)).toBe(8000);
    expect(await balance(CUSTOMER)).toBe(15000);
    expect((await integrityCheck(env.db)).ok).toBe(true);
  });

  it('can sell the same last unit again (the original is reversed before the new one posts)', async () => {
    const before = await cash();
    const sale = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(LAST, 1, 5000)] }));
    expect(sale.status).toBe('accepted');
    expect(await qty(LAST)).toBe(0);
    const r = await A.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(LAST, 1, 4500)] }, 'خصم للعميل'));
    expect(r.status).toBe('accepted');
    expect(await qty(LAST)).toBe(0);
    expect(await cash() - before).toBe(4500);
  });

  it('changes nothing when the corrected invoice can not be posted', async () => {
    const sale = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    const stockBefore = await qty(ITEM);
    const balBefore = await balance(CUSTOMER);
    const r = await A.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 500, 10000)] }));
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('الأصلية فضلت زي ما هي');
    expect((await row(sale.result.id)).status).toBe('posted');
    expect(await qty(ITEM)).toBe(stockBefore);
    expect(await balance(CUSTOMER)).toBe(balBefore);
  });

  it('refuses another customer, documents with collections on them, and drafts', async () => {
    const sale = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    const other = await A.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', party_id: OTHER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    expect(other.status).toBe('rejected');

    const rc = await A.op(doc({ doc_type: 'receipt', party_id: CUSTOMER, cashbox_id: 'cb-main', amount: 1000, ref_doc_id: sale.result.id }));
    expect(rc.status).toBe('accepted');
    const blocked = await A.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 2, 10000)] }));
    expect(blocked.status).toBe('rejected');

    const draft = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }, 'draft'));
    const notPosted = await A.op(amendOp(draft.result.id, { doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    expect(notPosted.status).toBe('rejected');
  });

  it('needs cancel permission (a cashier can not amend)', async () => {
    const r0 = await env.app.inject({ method: 'POST', url: '/api/admin/users', headers: A.headers, payload: { username: 'amendcashier', full_name: 'كاشير', role_id: 'role-cashier', password: 'secret12' } });
    expect(r0.statusCode).toBe(200);
    const C = await env.login('amendcashier', 'secret12', 'device-amend-cashier');
    const sale = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 10000)] }));
    const r = await C.op(amendOp(sale.result.id, { doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 10000)] }));
    expect(r.status).toBe('rejected');
    expect((await row(sale.result.id)).status).toBe('posted');
  });
});
