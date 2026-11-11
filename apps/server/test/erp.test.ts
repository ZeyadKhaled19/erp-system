import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportData, importData } from '../src/backup';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
let B: Client;

const ITEM = 'item-pen-0001';
const ITEM2 = 'item-book-0002';
const SUP = 'party-sup-0001';
const CUST = 'party-cus-0001';

async function balance(itemId: string, wh = 'wh-main') {
  return (await env.db.one(`select qty, value from stock_balances where item_id = $1 and warehouse_id = $2`, [itemId, wh])) ?? { qty: 0, value: 0 };
}
async function assertBooksBalanced() {
  const tb = await A.get('/api/reports/trial-balance');
  expect(tb.balanced).toBe(true);
  const bs = await A.get('/api/reports/balance-sheet?to=2099-12-31');
  expect(bs.balanced).toBe(true);
}

beforeAll(async () => {
  env = await setup();
  A = await env.login('admin', 'admin123', 'device-A-0001');
  B = await env.login('admin', 'admin123', 'device-B-0002');
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('auth', () => {
  it('rejects wrong password and unauthenticated requests', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'x', device_id: 'device-x-0001' } });
    expect(r.statusCode).toBe(401);
    const p = await env.app.inject({ method: 'GET', url: '/api/sync/pull' });
    expect(p.statusCode).toBe(401);
  });
  it('never stores plain passwords', async () => {
    const u = await env.db.one(`select password_hash from users where username = 'admin'`);
    expect(u.password_hash.startsWith('scrypt$')).toBe(true);
    expect(u.password_hash).not.toContain('admin123');
  });
});

describe('master data + purchases', () => {
  it('creates items and parties', async () => {
    const rs = await A.push([
      A.envelope(item(ITEM, 'P1', 'قلم جاف', { sale_price: 1000, reorder_level: 5000 })),
      A.envelope(item(ITEM2, 'B1', 'كشكول', { sale_price: 2500, units: [{ id: 'unit-box-0001', name: 'دستة', factor: 12000, sale_price: 27000 }] })),
      A.envelope(party(SUP, 'supplier', 'S1', 'مورد الأدوات')),
      A.envelope(party(CUST, 'customer', 'C1', 'محل النور', { credit_limit: 100000 })),
    ]);
    expect(rs.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
  });

  it('rejects duplicate code', async () => {
    const r = await A.op(item('item-dup-0001', 'P1', 'مكرر'));
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('مستخدم');
  });

  it('purchase invoice updates stock, average cost, supplier balance and journal', async () => {
    const r = await A.op(
      doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 100, 600, { tax_rate_bp: 1400 })] }),
    );
    expect(r.status).toBe('accepted');
    expect(r.result.number).toMatch(/^P-\d{5}$/);
    expect(await balance(ITEM)).toEqual({ qty: 100000, value: 60000 });
    const sup = await env.db.one(`select balance from parties where id = $1`, [SUP]);
    expect(sup.balance).toBe(60000 + 8400);
    // شراء ثاني بسعر مختلف → متوسط مرجح
    await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', paid: 0, lines: [line(ITEM, 100, 800)] }));
    expect(await balance(ITEM)).toEqual({ qty: 200000, value: 140000 });
    const it = await env.db.one(`select avg_cost, last_cost from items where id = $1`, [ITEM]);
    expect(it.avg_cost).toBe(700);
    expect(it.last_cost).toBe(800);
    await assertBooksBalanced();
  });

  it('buys in a secondary unit (dozen) and converts to base qty', async () => {
    const l = { ...line(ITEM2, 2, 24000), unit_name: 'دستة', unit_factor: 12000 };
    const r = await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [l] }));
    expect(r.status).toBe('accepted');
    expect(await balance(ITEM2)).toEqual({ qty: 24000, value: 48000 });
  });
});

describe('sales', () => {
  let invoiceId: string;
  let invoiceLine: any;
  it('cash sale: stock out at average cost, cash in, COGS', async () => {
    const before = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    const l = line(ITEM, 10, 1000, { tax_rate_bp: 1400 });
    const d = doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [l] });
    const r = await A.op(d);
    expect(r.status).toBe('accepted');
    const saved = await env.db.one(`select * from documents where id = $1`, [r.result.id]);
    expect(saved.total).toBe(10000 + 1400);
    expect(saved.paid).toBe(11400);
    expect(saved.cost).toBe(7000);
    const after = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    expect(after.balance - before.balance).toBe(11400);
    expect((await balance(ITEM)).qty).toBe(190000);
    await assertBooksBalanced();
  });

  it('credit sale with discount, partial payment, customer statement', async () => {
    const l = line(ITEM, 20, 1000, { discount: 1000 });
    const d = doc({ doc_type: 'sale_invoice', party_id: CUST, warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'credit', paid: 5000, discount: 1000, lines: [l] });
    const r = await A.op(d);
    expect(r.status).toBe('accepted');
    invoiceId = r.result.id;
    invoiceLine = l;
    const inv = await env.db.one(`select * from documents where id = $1`, [invoiceId]);
    expect(inv.total).toBe(20000 - 2000);
    const c = await env.db.one(`select balance from parties where id = $1`, [CUST]);
    expect(c.balance).toBe(13000);
    const st = await A.get(`/api/reports/party/${CUST}`);
    expect(st.closing).toBe(13000);
    await assertBooksBalanced();
  });

  it('sale return linked to invoice restores stock at original cost and limits qty', async () => {
    const tooMuch = await A.op(
      doc({ doc_type: 'sale_return', party_id: CUST, warehouse_id: 'wh-main', ref_doc_id: invoiceId, lines: [line(ITEM, 25, 1000, { ref_line_id: invoiceLine.id })] }),
    );
    expect(tooMuch.status).toBe('rejected');
    const before = await balance(ITEM);
    const r = await A.op(
      doc({ doc_type: 'sale_return', party_id: CUST, warehouse_id: 'wh-main', ref_doc_id: invoiceId, lines: [line(ITEM, 5, 900, { ref_line_id: invoiceLine.id })] }),
    );
    expect(r.status).toBe('accepted');
    const after = await balance(ITEM);
    expect(after.qty - before.qty).toBe(5000);
    expect(after.value - before.value).toBe(3500);
    const c = await env.db.one(`select balance from parties where id = $1`, [CUST]);
    expect(c.balance).toBe(13000 - 4500);
    await assertBooksBalanced();
  });

  it('receipt linked to invoice reduces customer balance and updates invoice paid', async () => {
    const r = await A.op(doc({ doc_type: 'receipt', party_id: CUST, cashbox_id: 'cb-main', amount: 3000, ref_doc_id: invoiceId }));
    expect(r.status).toBe('accepted');
    // المدفوع 50 + مرتجع آجل 45 خُصم من الفاتورة + قبض 30
    const inv = await env.db.one(`select paid from documents where id = $1`, [invoiceId]);
    expect(inv.paid).toBe(12500);
    const c = await env.db.one(`select balance from parties where id = $1`, [CUST]);
    expect(c.balance).toBe(8500 - 3000);
  });

  it('rejects unbalanced manual journal entry', async () => {
    const r = await A.op(
      doc({
        doc_type: 'journal_voucher',
        journal_lines: [
          { account_id: 'acc-5201', debit: 1000, credit: 0 },
          { account_id: 'acc-110101', debit: 0, credit: 900 },
        ],
      }),
    );
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('متوازن');
  });

  it('expense reduces cash and shows in income statement', async () => {
    const r = await A.op(doc({ doc_type: 'expense', account_id: 'acc-5201', cashbox_id: 'cb-main', amount: 2000, notes: 'إيجار' }));
    expect(r.status).toBe('accepted');
    const is = await A.get('/api/reports/income-statement');
    expect(is.total_expenses).toBeGreaterThanOrEqual(2000);
    await assertBooksBalanced();
  });
});

describe('sync safety', () => {
  it('same op sent twice (network retry) is applied once', async () => {
    const before = await balance(ITEM);
    const e = A.envelope(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 1000)] }));
    const [r1] = await A.push([e]);
    const [r2] = await A.push([e]);
    expect(r1.status).toBe('accepted');
    expect(r2).toEqual(r1);
    const after = await balance(ITEM);
    expect(before.qty - after.qty).toBe(1000);
    const n = await env.db.one(`select count(*)::int as n from documents where id = $1`, [r1.result.id]);
    expect(n.n).toBe(1);
  });

  it('offline: customer + item + invoice created offline then pushed in order', async () => {
    const cust = uuid();
    const it = uuid();
    const ops = [
      A.envelope(party(cust, 'customer', 'OFF-C1', 'عميل أوفلاين')),
      A.envelope(item(it, 'OFF-1', 'صنف أوفلاين', { sale_price: 500 })),
      A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(it, 10, 300)] })),
      A.envelope(doc({ doc_type: 'sale_invoice', party_id: cust, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(it, 4, 500)], local_number: 'محلي-1' })),
    ];
    const rs = await A.push(ops);
    expect(rs.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect((await balance(it)).qty).toBe(6000);
    expect((await env.db.one(`select balance from parties where id = $1`, [cust])).balance).toBe(2000);
  });

  it('invoice referencing a customer that failed to sync is rejected with a clear reason', async () => {
    const r = await A.op(doc({ doc_type: 'sale_invoice', party_id: 'missing-party-1', warehouse_id: 'wh-main', lines: [line(ITEM, 1, 1000)] }));
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('غير موجود');
  });

  it('two devices sell the same last units offline → second goes to review, not silently negative', async () => {
    const it = uuid();
    await A.push([A.envelope(item(it, 'LAST-1', 'آخر قطعة', { sale_price: 1000 })), A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(it, 3, 500)] }))]);
    // كلا الجهازين رأى الرصيد 3 وباع 2 دون اتصال
    const ra = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(it, 2, 1000)] }));
    const rb = await B.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(it, 2, 1000)] }));
    expect(ra.status).toBe('accepted');
    expect(rb.status).toBe('conflict');
    expect(rb.result.status).toBe('pending_review');
    expect((await balance(it)).qty).toBe(1000);
    const conflict = await env.db.one(`select * from sync_conflicts where id = $1`, [rb.result.conflict_id]);
    expect(conflict.kind).toBe('stock_shortage');
    // مستخدم مخول يقرر الترحيل رغم العجز
    const res = await A.op({ type: 'conflict.resolve', id: conflict.id, resolution: 'post_anyway', note: 'البضاعة موجودة فعليًا' });
    expect(res.status).toBe('accepted');
    expect((await balance(it)).qty).toBe(-1000);
    await assertBooksBalanced();
  });

  it('concurrent edit of the same item from two devices creates a conflict instead of overwriting', async () => {
    const it = uuid();
    await A.op(item(it, 'EDIT-1', 'اسم أصلي'));
    const ra = await A.op({ type: 'master.upsert', entity: 'item', id: it, base_version: 1, data: { code: 'EDIT-1', name: 'تعديل A' } });
    const rb = await B.op({ type: 'master.upsert', entity: 'item', id: it, base_version: 1, data: { code: 'EDIT-1', name: 'تعديل B' } });
    expect(ra.status).toBe('accepted');
    expect(rb.status).toBe('conflict');
    expect((await env.db.one(`select name from items where id = $1`, [it])).name).toBe('تعديل A');
    const r = await A.op({ type: 'conflict.resolve', id: rb.result.conflict_id, resolution: 'apply_client' });
    expect(r.status).toBe('accepted');
    expect((await env.db.one(`select name from items where id = $1`, [it])).name).toBe('تعديل B');
  });

  it('pull returns incremental changes', async () => {
    const p1 = await A.get('/api/sync/pull?cursor=0');
    expect(p1.changes.items.length).toBeGreaterThan(0);
    expect(p1.changes.users[0].password_hash).toBeUndefined();
    let cursor = p1.cursor;
    let more = p1.more;
    while (more) {
      const p = await A.get(`/api/sync/pull?cursor=${cursor}`);
      cursor = p.cursor;
      more = p.more;
    }
    const it = uuid();
    await B.op(item(it, 'NEW-PULL', 'صنف جديد من جهاز B'));
    const p2 = await A.get(`/api/sync/pull?cursor=${cursor}`);
    expect(p2.changes.items.map((x: any) => x.id)).toEqual([it]);
  });
});

describe('cancel / inventory', () => {
  it('cancelling a posted invoice reverses stock and journal, keeps the original', async () => {
    const before = await balance(ITEM);
    const r = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 3, 1000)] }));
    const c = await A.op({ type: 'doc.cancel', id: r.result.id, reason: 'خطأ في الإدخال' });
    expect(c.status).toBe('accepted');
    expect(await balance(ITEM)).toEqual(before);
    const entries = await env.db.query(`select * from journal_entries where document_id = $1`, [r.result.id]);
    expect(entries.length).toBe(2);
    const d = await env.db.one(`select status, cancel_reason from documents where id = $1`, [r.result.id]);
    expect(d.status).toBe('cancelled');
    const edit = await A.op({ type: 'doc.save', action: 'post', base_version: 1, doc: { id: r.result.id, doc_type: 'sale_invoice', date: '2026-11-01', lines: [], journal_lines: [], paid: 0, amount: 0, discount: 0 } as any });
    expect(edit.status).toBe('rejected');
    await assertBooksBalanced();
  });

  it('transfer between warehouses moves qty and value', async () => {
    await A.op({ type: 'master.upsert', entity: 'warehouse', id: 'wh-branch-01', base_version: null, data: { code: '2', name: 'مخزن الفرع' } });
    const src = await balance(ITEM);
    const r = await A.op(doc({ doc_type: 'stock_transfer', warehouse_id: 'wh-main', to_warehouse_id: 'wh-branch-01', lines: [line(ITEM, 10, 0)] }));
    expect(r.status).toBe('accepted');
    const dst = await balance(ITEM, 'wh-branch-01');
    expect(dst.qty).toBe(10000);
    const src2 = await balance(ITEM);
    expect(src.value - src2.value).toBe(dst.value);
    const bad = await A.op(doc({ doc_type: 'stock_transfer', warehouse_id: 'wh-branch-01', to_warehouse_id: 'wh-main', lines: [line(ITEM, 50, 0)] }));
    expect(bad.status).toBe('conflict');
  });

  it('stock count adjustment posts differences', async () => {
    const r = await A.op(doc({ doc_type: 'stock_adjustment', warehouse_id: 'wh-branch-01', notes: 'جرد سنوي', lines: [line(ITEM, 8, 0)] }));
    expect(r.status).toBe('accepted');
    expect((await balance(ITEM, 'wh-branch-01')).qty).toBe(8000);
    const l = await env.db.one(`select system_qty from document_lines where document_id = $1`, [r.result.id]);
    expect(l.system_qty).toBe(10000);
    await assertBooksBalanced();
  });

  it('reorder report lists only items at/below reorder level', async () => {
    const it = uuid();
    await A.op(item(it, 'RO-1', 'صنف حد طلب', { reorder_level: 5000 }));
    const r = await A.get('/api/reports/reorder');
    expect(r.rows.some((x: any) => x.id === it)).toBe(true);
    expect(r.rows.some((x: any) => x.id === ITEM)).toBe(false);
  });

  it('item movement report has running balance', async () => {
    const r = await A.get(`/api/reports/item/${ITEM}?warehouse_id=wh-main`);
    expect(r.moves.length).toBeGreaterThan(3);
    expect(r.closing).toBe((await balance(ITEM)).qty);
  });
});

describe('permissions', () => {
  it('cashier cannot change prices or cancel', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: A.headers,
      payload: { username: 'cashier1', full_name: 'كاشير', role_id: 'role-cashier', password: 'secret12' },
    });
    expect(res.statusCode).toBe(200);
    const C = await env.login('cashier1', 'secret12', 'device-C-0003');
    const r = await C.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 1)] }));
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('صلاحية');
    const ok = await C.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 1000)] }));
    expect(ok.status).toBe('accepted');
    const c = await C.op({ type: 'doc.cancel', id: ok.result.id, reason: 'تجربة الإلغاء' });
    expect(c.status).toBe('rejected');
    const tb = await env.app.inject({ method: 'GET', url: '/api/reports/trial-balance', headers: C.headers });
    expect(tb.statusCode).toBe(403);
  });
});

describe('backup & restore', () => {
  it('exports and restores the full database', async () => {
    const before = await A.get('/api/reports/trial-balance');
    const data = await exportData(env.db);
    await A.op(item(uuid(), 'AFTER-BK', 'بعد النسخة'));
    await importData(env.db, data);
    const gone = await env.db.one(`select count(*)::int as n from items where code = 'AFTER-BK'`);
    expect(gone.n).toBe(0);
    const after = await A.get('/api/reports/trial-balance');
    expect(after.totals).toEqual(before.totals);
    // يستمر العمل بعد الاستعادة (التسلسلات مضبوطة)
    const r = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 1000)] }));
    expect(r.status).toBe('accepted');
    await assertBooksBalanced();
  });
});
