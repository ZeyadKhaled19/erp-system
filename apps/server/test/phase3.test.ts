import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const IT = 'p3-item';
const SER = 'p3-serial';
const CUS = 'p3-cus';
const SUP = 'p3-sup';

const bal = async (itemId: string) => (await env.db.one(`select qty, value from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [itemId])) ?? { qty: 0, value: 0 };
const cash = async () => (await env.db.one(`select balance from cashboxes where id = 'cb-main'`)).balance;
async function balanced() {
  expect((await A.get('/api/reports/trial-balance')).balanced).toBe(true);
  expect((await A.get('/api/reports/balance-sheet?to=2099-12-31')).balanced).toBe(true);
}

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(IT, 'P3', 'صنف تسليم', { sale_price: 2000 })),
    A.envelope(item(SER, 'P3S', 'جهاز بسيريال', { sale_price: 100000, track_serial: true })),
    A.envelope(party(CUS, 'customer', 'P3C', 'عميل تسليم')),
    A.envelope(party(SUP, 'supplier', 'P3P', 'مورد تكلفة')),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('landed cost', () => {
  it('purchase charges (supplier-added and paid expense) are loaded onto item cost', async () => {
    const cashBefore = await cash();
    const r = await A.op(
      doc({
        doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main',
        lines: [line(IT, 10, 1000), line(SER, 2, 50000, { serials: ['SN-1', 'SN-2'] })],
        charges: [
          { id: uuid(), name: 'شحن من المورد', mode: 'add', amount: 2200 },
          { id: uuid(), name: 'نقل دفعناه', mode: 'expense', amount: 1100, cashbox_id: 'cb-main' },
        ],
      }),
    );
    expect(r.status).toBe('accepted');
    const d = await env.db.one(`select * from documents where id = $1`, [r.result.id]);
    expect(d.total).toBe(10000 + 100000 + 2200);
    expect(d.cost).toBe(110000 + 3300);
    // صافي السطرين 100 و 1000 → المصروفات 33 تتوزع 3 و 30
    expect((await bal(IT)).value).toBe(10000 + 300);
    expect((await bal(SER)).value).toBe(100000 + 3000);
    expect(await cash()).toBe(cashBefore - 1100);
    expect((await env.db.one(`select balance from parties where id = $1`, [SUP])).balance).toBe(112200);
    await balanced();
  });

  it('sale with delivery fee (added) and an invoice expense', async () => {
    const r = await A.op(
      doc({
        doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', lines: [line(IT, 1, 2000)],
        charges: [
          { id: uuid(), name: 'رسوم توصيل', mode: 'add', amount: 500 },
          { id: uuid(), name: 'مصروف تغليف', mode: 'expense', amount: 100, cashbox_id: 'cb-main' },
        ],
      }),
    );
    expect(r.status).toBe('accepted');
    const d = await env.db.one(`select total from documents where id = $1`, [r.result.id]);
    expect(d.total).toBe(2500);
    const is = await A.get('/api/reports/income-statement');
    expect(is.revenue.some((x: any) => x.system_key === 'other_income' && x.net === 500)).toBe(true);
    await balanced();
  });
});

describe('deferred and partial delivery', () => {
  let invId: string;
  let lines: any[];
  it('deferred invoice deducts stock at posting, serials recorded at delivery', async () => {
    const l1 = line(IT, 5, 2000);
    const l2 = line(SER, 2, 100000);
    const r = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', deliver_later: true, shipping_company: 'أرامكس', lines: [l1, l2] }));
    expect(r.status).toBe('accepted');
    invId = r.result.id;
    lines = await env.db.query(`select * from document_lines where document_id = $1 order by line_no`, [invId]);
    expect(lines.every((l) => l.delivered_qty === 0)).toBe(true);
    expect((await bal(SER)).qty).toBe(0);
    // السيريال لم يُصرف بعد
    expect((await env.db.query(`select status from serials where serial in ('SN-1','SN-2')`)).every((s: any) => s.status === 'in_stock')).toBe(true);
    await balanced();
  });

  it('partial delivery then the rest; over-delivery rejected', async () => {
    const d1 = await A.op({ type: 'delivery.record', id: uuid(), document_id: invId, date: '2026-11-12', lines: [{ line_id: lines[0].id, qty: 2000, serials: [] }, { line_id: lines[1].id, qty: 1000, serials: ['SN-1'] }] });
    expect(d1.status).toBe('accepted');
    expect(d1.result.remaining).toBe(4000);
    const over = await A.op({ type: 'delivery.record', id: uuid(), document_id: invId, date: '2026-11-12', lines: [{ line_id: lines[0].id, qty: 4000, serials: [] }] });
    expect(over.status).toBe('rejected');
    const badSerial = await A.op({ type: 'delivery.record', id: uuid(), document_id: invId, date: '2026-11-12', lines: [{ line_id: lines[1].id, qty: 1000, serials: ['SN-1'] }] });
    expect(badSerial.status).toBe('rejected');
    const d2 = await A.op({ type: 'delivery.record', id: uuid(), document_id: invId, date: '2026-11-13', lines: [{ line_id: lines[0].id, qty: 3000, serials: [] }, { line_id: lines[1].id, qty: 1000, serials: ['SN-2'] }] });
    expect(d2.status).toBe('accepted');
    expect(d2.result.remaining).toBe(0);
    expect((await env.db.query(`select status from serials where serial in ('SN-1','SN-2')`)).every((s: any) => s.status === 'sold')).toBe(true);
    const det = await A.get(`/api/documents/${invId}`);
    expect(det.deliveries.length).toBe(2);
    expect(det.doc.order_status).toBe('تم التسليم');
  });

  it('cannot cancel a partially delivered invoice', async () => {
    const c = await A.op({ type: 'doc.cancel', id: invId, reason: 'محاولة إلغاء بعد التسليم' });
    expect(c.status).toBe('rejected');
    expect(c.message).toContain('تسليم');
  });

  it('immediate invoices are fully delivered', async () => {
    const r = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(IT, 1, 2000)] }));
    const l = await env.db.one(`select base_qty, delivered_qty from document_lines where document_id = $1`, [r.result.id]);
    expect(l.delivered_qty).toBe(l.base_qty);
  });
});
