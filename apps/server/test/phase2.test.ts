import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const IT = 'p2-item-1';
const CUS = 'p2-cus-1';
const SUP = 'p2-sup-1';
const CARD = 'p2-card-box';

const bal = async (itemId: string, wh = 'wh-main') => (await env.db.one(`select qty, value from stock_balances where item_id = $1 and warehouse_id = $2`, [itemId, wh])) ?? { qty: 0, value: 0 };
const party$ = async (id: string) => (await env.db.one(`select balance from parties where id = $1`, [id])).balance;
const cash$ = async (id: string) => (await env.db.one(`select balance from cashboxes where id = $1`, [id])).balance;
const docRow = async (id: string) => env.db.one(`select * from documents where id = $1`, [id]);
async function balanced() {
  const tb = await A.get('/api/reports/trial-balance');
  expect(tb.balanced).toBe(true);
  const bs = await A.get('/api/reports/balance-sheet?to=2099-12-31');
  expect(bs.balanced).toBe(true);
}
async function makeUser(username: string, role: string, extra: Record<string, unknown> = {}) {
  const r = await env.app.inject({ method: 'POST', url: '/api/admin/users', headers: A.headers, payload: { username, full_name: username, role_id: role, password: 'secret12', ...extra } });
  expect(r.statusCode).toBe(200);
  return env.login(username, 'secret12', `device-${username}-01`);
}

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(IT, 'P2-1', 'صنف المرحلة 2', { sale_price: 10000 })),
    A.envelope(party(CUS, 'customer', 'P2C', 'عميل المرحلة 2')),
    A.envelope(party(SUP, 'supplier', 'P2S', 'مورد المرحلة 2')),
    A.envelope({ type: 'master.upsert', entity: 'cashbox', id: CARD, base_version: null, data: { name: 'بطاقات ائتمان', kind: 'bank', fee_bp: 200, fee_min: 100 } }),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(IT, 100, 6000)] })),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('split payments and fees', () => {
  it('sale paid from two cashboxes with card fee', async () => {
    const cashBefore = await cash$('cb-main');
    const r = await A.op(
      doc({
        doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', lines: [line(IT, 1, 10000)],
        payments: [{ id: uuid(), cashbox_id: 'cb-main', amount: 6000 }, { id: uuid(), cashbox_id: CARD, amount: 4000 }],
      }),
    );
    expect(r.status).toBe('accepted');
    expect(await cash$('cb-main')).toBe(cashBefore + 6000);
    // عمولة 2% من 40 = 0.80 أقل من الحد الأدنى 1.00
    expect(await cash$(CARD)).toBe(4000 - 100);
    const d = await docRow(r.result.id);
    expect(d.paid).toBe(10000);
    expect(await party$(CUS)).toBe(0);
    const pays = await env.db.query(`select * from document_payments where document_id = $1`, [r.result.id]);
    expect(pays.length).toBe(2);
    await balanced();
  });

  it('cash transfer between cashboxes', async () => {
    const a = await cash$('cb-main');
    const b = await cash$(CARD);
    const r = await A.op(doc({ doc_type: 'cash_transfer', cashbox_id: 'cb-main', to_cashbox_id: CARD, amount: 1000 }));
    expect(r.status).toBe('accepted');
    expect(await cash$('cb-main')).toBe(a - 1000);
    expect(await cash$(CARD)).toBe(b + 1000);
  });
});

describe('cheques, installments, allocation', () => {
  let invId: string;
  it('sale with cheque + 2 installments', async () => {
    const r = await A.op(
      doc({
        doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', lines: [line(IT, 3, 10000)],
        payments: [{ id: uuid(), cashbox_id: 'cb-main', amount: 5000 }],
        instruments: [
          { id: 'chq-1', kind: 'cheque', amount: 10000, due_date: '2026-12-01', cheque_no: '777', bank: 'بنك مصر' },
          { id: 'ins-1', kind: 'installment', amount: 7500, due_date: '2026-12-15' },
          { id: 'ins-2', kind: 'installment', amount: 7500, due_date: '2027-01-15' },
        ],
      }),
    );
    expect(r.status).toBe('accepted');
    invId = r.result.id;
    const d = await docRow(invId);
    expect(d.paid).toBe(15000); // نقدي + شيك
    expect(await party$(CUS)).toBe(15000); // الأقساط ما زالت مستحقة على العميل
    const ins = await env.db.query(`select * from instruments where document_id = $1 order by due_date`, [invId]);
    expect(ins.map((x) => x.status)).toEqual(['open', 'open', 'open']);
    await balanced();
  });

  it('collect installment → receipt allocated to the invoice', async () => {
    const r = await A.op({ type: 'instrument.settle', id: 'ins-1', action: 'collect', cashbox_id: 'cb-main', date: '2026-12-15' });
    expect(r.status).toBe('accepted');
    expect((await docRow(invId)).paid).toBe(22500);
    expect(await party$(CUS)).toBe(7500);
    expect((await env.db.one(`select status from instruments where id = 'ins-1'`)).status).toBe('collected');
  });

  it('bounced cheque returns the debt to the customer', async () => {
    const r = await A.op({ type: 'instrument.settle', id: 'chq-1', action: 'bounce', date: '2026-12-02', note: 'رصيد غير كافٍ' });
    expect(r.status).toBe('accepted');
    expect(await party$(CUS)).toBe(17500);
    expect((await docRow(invId)).paid).toBe(12500);
    await balanced();
  });

  it('unlinked receipt is allocated FIFO to the oldest open invoice', async () => {
    const older = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', date: '2026-10-01', lines: [line(IT, 1, 10000)] }));
    const r = await A.op(doc({ doc_type: 'receipt', party_id: CUS, cashbox_id: 'cb-main', amount: 12000 }));
    expect(r.status).toBe('accepted');
    expect((await docRow(older.result.id)).paid).toBe(10000);
    expect((await docRow(invId)).paid).toBe(12500 + 2000);
    // إلغاء القبض يعيد التخصيص
    const c = await A.op({ type: 'doc.cancel', id: r.result.id, reason: 'اختبار عكس التخصيص' });
    expect(c.status).toBe('accepted');
    expect((await docRow(older.result.id)).paid).toBe(0);
    expect((await docRow(invId)).paid).toBe(12500);
  });

  it('due date defaults from settings and invoice can be closed', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { default_due_days: 30 } });
    const r = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', date: '2026-11-01', lines: [line(IT, 1, 10000)] }));
    expect((await docRow(r.result.id)).due_date).toBe('2026-12-01');
    const c = await A.op({ type: 'doc.close', id: r.result.id, closed: true });
    expect(c.status).toBe('accepted');
    expect((await docRow(r.result.id)).closed).toBe(true);
  });
});

describe('returns, quotations, price lists, limits', () => {
  it('free return needs permission; admin can, valued at average cost', async () => {
    const C = await makeUser('cash2', 'role-cashier');
    const r1 = await C.op(doc({ doc_type: 'sale_return', party_id: CUS, warehouse_id: 'wh-main', lines: [line(IT, 1, 10000)] }));
    expect(r1.status).toBe('rejected');
    const before = await bal(IT);
    const r2 = await A.op(doc({ doc_type: 'sale_return', party_id: CUS, warehouse_id: 'wh-main', lines: [line(IT, 1, 10000)] }));
    expect(r2.status).toBe('accepted');
    const after = await bal(IT);
    expect(after.qty - before.qty).toBe(1000);
    expect(after.value - before.value).toBe(6000);
    await balanced();
  });

  it('quotation with reservation blocks overselling and converts to invoice', async () => {
    const it2 = uuid();
    await A.push([A.envelope(item(it2, 'RSV-1', 'صنف حجز', { sale_price: 1000 })), A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(it2, 6, 500)] }))]);
    const q = await A.op(doc({ doc_type: 'quotation', party_id: CUS, warehouse_id: 'wh-main', reserve: true, lines: [line(it2, 5, 1000)] }));
    expect(q.status).toBe('accepted');
    expect((await bal(it2)).qty).toBe(6000); // العرض لا يحرك المخزون
    const s = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(it2, 3, 1000)] }));
    expect(s.status).toBe('conflict');
    const conv = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', from_quotation_id: q.result.id, lines: [line(it2, 5, 1000)] }));
    expect(conv.status).toBe('accepted');
    expect((await docRow(q.result.id)).converted_to_id).toBe(conv.result.id);
    expect((await bal(it2)).qty).toBe(1000);
  });

  it('price list prices apply and are enforced without price-change permission', async () => {
    const wc = uuid();
    await A.push([
      A.envelope(party(wc, 'customer', 'WHS', 'عميل جملة', { price_list_id: 'pl-wholesale' })),
      A.envelope({ type: 'master.upsert', entity: 'item', id: IT, base_version: 1, data: { code: 'P2-1', name: 'صنف المرحلة 2', sale_price: 10000, prices: [{ unit_name: 'قطعة', price_list_id: 'pl-wholesale', price: 9000 }] } }),
    ]);
    const C = await makeUser('cash3', 'role-cashier');
    const bad = await C.op(doc({ doc_type: 'sale_invoice', party_id: wc, warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(IT, 1, 10000)] }));
    expect(bad.status).toBe('rejected');
    const ok = await C.op(doc({ doc_type: 'sale_invoice', party_id: wc, warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(IT, 1, 9000)] }));
    expect(ok.status).toBe('accepted');
  });

  it('min price, below-cost and discount limits', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/admin/roles', headers: A.headers, payload: { id: 'role-limited', name: 'بائع محدود', permissions: ['sales.create', 'sales.post', 'sales.discount', 'sales.price_change', 'sales.credit', 'items.view'], limits: { max_discount_bp: 500 } } });
    expect(r.statusCode).toBe(200);
    const L = await makeUser('limited1', 'role-limited');
    const it3 = uuid();
    await A.push([A.envelope(item(it3, 'MIN-1', 'صنف أقل سعر', { sale_price: 10000, min_price: 8000 })), A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(it3, 10, 5000)] }))]);
    const below = await L.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(it3, 1, 7000)] }));
    expect(below.status).toBe('rejected');
    expect(below.message).toContain('أقل سعر');
    const disc = await L.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', discount: 1000, lines: [line(it3, 1, 10000)] }));
    expect(disc.status).toBe('rejected');
    const ok = await L.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', discount: 500, lines: [line(it3, 1, 10000)] }));
    expect(ok.status).toBe('accepted');
    const cost = await L.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(IT, 1, 5000)] }));
    expect(cost.status).toBe('rejected');
  });

  it('service item has no stock movement', async () => {
    const svc = uuid();
    await A.op(item(svc, 'SVC-1', 'تركيب', { sale_price: 5000, is_service: true }));
    const r = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(svc, 2, 5000)] }));
    expect(r.status).toBe('accepted');
    expect(await env.db.one(`select 1 from stock_balances where item_id = $1`, [svc])).toBeUndefined();
    await balanced();
  });
});

describe('serials and expiry', () => {
  const SER = 'ser-item-1';
  it('strict serial tracking', async () => {
    await A.op(item(SER, 'SER-1', 'موبايل', { sale_price: 500000, track_serial: true }));
    const wrong = await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(SER, 2, 300000, { serials: ['IMEI-1'] })] }));
    expect(wrong.status).toBe('rejected');
    const p = await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(SER, 2, 300000, { serials: ['IMEI-1', 'IMEI-2'] })] }));
    expect(p.status).toBe('accepted');
    const dup = await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(SER, 1, 300000, { serials: ['IMEI-1'] })] }));
    expect(dup.status).toBe('rejected');
    const s1 = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(SER, 1, 500000, { serials: ['IMEI-1'] })] }));
    expect(s1.status).toBe('accepted');
    const twice = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(SER, 1, 500000, { serials: ['IMEI-1'] })] }));
    expect(twice.status).toBe('rejected');
    expect(twice.message).toContain('مُباع');
    const search = await A.get('/api/reports/serial?q=IMEI-1');
    expect(search.rows.length).toBeGreaterThanOrEqual(2);
    const c = await A.op({ type: 'doc.cancel', id: s1.result.id, reason: 'إلغاء بيع سيريال' });
    expect(c.status).toBe('accepted');
    expect((await env.db.one(`select status from serials where serial = 'IMEI-1'`)).status).toBe('in_stock');
  });

  it('expiry lots with FEFO', async () => {
    const EX = uuid();
    await A.op(item(EX, 'EXP-1', 'دواء', { sale_price: 2000, track_expiry: true }));
    const noExp = await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(EX, 5, 1000)] }));
    expect(noExp.status).toBe('rejected');
    await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(EX, 5, 1000, { expiry: '2027-06-01' })] }));
    await A.op(doc({ doc_type: 'purchase_invoice', party_id: SUP, warehouse_id: 'wh-main', lines: [line(EX, 5, 1000, { expiry: '2027-01-01' })] }));
    const s = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(EX, 7, 2000)] }));
    expect(s.status).toBe('accepted');
    const lots = await env.db.query(`select expiry, qty from stock_lots where item_id = $1 order by expiry`, [EX]);
    expect(lots).toEqual([{ expiry: '2027-01-01', qty: 0 }, { expiry: '2027-06-01', qty: 3000 }]);
    const rep = await A.get('/api/reports/expiry');
    expect(rep.rows.some((r: any) => r.item_id === EX && r.qty === 3000)).toBe(true);
  });
});

describe('partners', () => {
  it('capital, withdrawals and profit distribution for a chosen period', async () => {
    const P1 = 'partner-1';
    const P2 = 'partner-2';
    await A.push([
      A.envelope({ type: 'master.upsert', entity: 'partner', id: P1, base_version: null, data: { name: 'أحمد', ownership_bp: 6000, profit_bp: 5000 } }),
      A.envelope({ type: 'master.upsert', entity: 'partner', id: P2, base_version: null, data: { name: 'محمود', ownership_bp: 4000, profit_bp: 4000 } }),
    ]);
    // مجموع نسب الأرباح 90% → يُرفض التوزيع
    const bad = await A.op(doc({ doc_type: 'profit_distribution', period_from: '2026-01-01', period_to: '2026-12-31' }, 'draft'));
    expect(bad.status).toBe('rejected');
    expect(bad.message).toContain('100%');
    await A.op({ type: 'master.upsert', entity: 'partner', id: P2, base_version: 1, data: { name: 'محمود', ownership_bp: 4000, profit_bp: 5000 } });

    const cap = await A.op(doc({ doc_type: 'partner_capital', partner_id: P1, cashbox_id: 'cb-main', amount: 1000000 }));
    expect(cap.status).toBe('accepted');
    const wd = await A.op(doc({ doc_type: 'partner_withdrawal', partner_id: P2, cashbox_id: 'cb-main', amount: 2000 }));
    expect(wd.status).toBe('accepted');

    const is = await A.get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31');
    expect(is.net_profit).toBeGreaterThan(0);
    const draft = await A.op(doc({ doc_type: 'profit_distribution', period_from: '2026-01-01', period_to: '2026-12-31', retained_bp: 2000 }, 'draft'));
    expect(draft.status).toBe('accepted');
    const d = await docRow(draft.result.id);
    const retained = Math.round((is.net_profit * 2000) / 10000);
    expect(d.total).toBe(is.net_profit - retained);
    expect(d.data.shares.reduce((s: number, x: any) => s + x.amount, 0)).toBe(d.total);

    // كاشير لا يعتمد التوزيع
    const C = await makeUser('cash4', 'role-cashier');
    const cp = await C.op({ type: 'doc.post', id: draft.result.id, base_version: null });
    expect(cp.status).toBe('rejected');
    const post = await A.op({ type: 'doc.post', id: draft.result.id, base_version: null });
    expect(post.status).toBe('accepted');

    const rep = await A.get('/api/reports/partners');
    const p1 = rep.partners.find((p: any) => p.id === P1);
    const p2 = rep.partners.find((p: any) => p.id === P2);
    expect(p1.capital).toBe(1000000);
    expect(p1.current).toBe(d.data.shares.find((s: any) => s.partner_id === P1).amount);
    expect(p2.current).toBe(d.data.shares.find((s: any) => s.partner_id === P2).amount - 2000);

    const overlap = await A.op(doc({ doc_type: 'profit_distribution', period_from: '2026-06-01', period_to: '2026-06-30' }, 'draft'));
    expect(overlap.status).toBe('rejected');
    await balanced();
  });
});

describe('controls', () => {
  it('locked period rejects posting', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { locked_until: '2026-01-31' } });
    expect(r.statusCode).toBe(200);
    const old = await A.op(doc({ doc_type: 'expense', account_id: 'acc-5201', cashbox_id: 'cb-main', amount: 100, date: '2026-01-15' }));
    expect(old.status).toBe('rejected');
    expect(old.message).toContain('مقفلة');
    await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { locked_until: null } });
  });

  it('cashier shift close records shortage', async () => {
    const C = await makeUser('shift1', 'role-cashier');
    const SH = uuid();
    expect((await C.op({ type: 'shift.open', id: SH, cashbox_id: 'cb-main', opening_float: 50000 })).status).toBe('accepted');
    expect((await C.op({ type: 'shift.open', id: uuid(), cashbox_id: 'cb-main', opening_float: 0 })).status).toBe('rejected');
    const s = await C.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', shift_id: SH, lines: [line(IT, 1, 10000)] }));
    expect(s.status).toBe('accepted');
    const exp = await C.get(`/api/shifts/${SH}/expected`);
    expect(exp.expected).toBe(60000);
    const close = await C.op({ type: 'shift.close', id: SH, counted_cash: 59500, date: '2026-11-11' });
    expect(close.status).toBe('accepted');
    expect(close.result.difference).toBe(-500);
    await balanced();
  });

  it('user restricted to a warehouse', async () => {
    await A.op({ type: 'master.upsert', entity: 'warehouse', id: 'wh-p2-b', base_version: null, data: { code: 'B2', name: 'فرع 2' } });
    const R = await makeUser('branch2', 'role-cashier', { warehouse_ids: ['wh-p2-b'] });
    const r = await R.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(IT, 1, 10000)] }));
    expect(r.status).toBe('rejected');
    expect(r.message).toContain('المخزن');
  });
});
