import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const IT = 'p4-item';
const REP = 'p4-rep';
const CUS = 'p4-cus';

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(IT, 'P4', 'صنف عمولة', { sale_price: 10000 })),
    A.envelope(party(CUS, 'customer', 'P4C', 'عميل عمولة')),
    A.envelope({ type: 'master.upsert', entity: 'sales_rep', id: REP, base_version: null, data: { name: 'مندوب 1', commission_bp: 500 } }),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', date: '2025-01-01', lines: [line(IT, 100, 5000)] })),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('sales rep commissions', () => {
  it('computes commission on net sales after returns and tracks payout', async () => {
    const inv = line(IT, 4, 10000);
    const r1 = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUS, warehouse_id: 'wh-main', sales_rep_id: REP, date: '2025-06-01', lines: [inv] }));
    expect(r1.status).toBe('accepted');
    const ret = await A.op(doc({ doc_type: 'sale_return', party_id: CUS, warehouse_id: 'wh-main', sales_rep_id: REP, date: '2025-06-02', ref_doc_id: r1.result.id, lines: [line(IT, 1, 10000, { ref_line_id: inv.id })] }));
    expect(ret.status).toBe('accepted');
    let rep = (await A.get('/api/reports/commissions?from=2025-01-01&to=2025-12-31')).rows.find((x: any) => x.id === REP);
    expect(rep.net).toBe(30000);
    expect(rep.commission).toBe(1500);
    expect(rep.due).toBe(1500);
    const pay = await A.op(doc({ doc_type: 'expense', account_id: 'acc-5208', cashbox_id: 'cb-main', amount: 1000, sales_rep_id: REP, date: '2025-06-30', notes: 'عمولة' }));
    expect(pay.status).toBe('accepted');
    rep = (await A.get('/api/reports/commissions?from=2025-01-01&to=2025-12-31')).rows.find((x: any) => x.id === REP);
    expect(rep.paid).toBe(1000);
    expect(rep.due).toBe(500);
  });
});

describe('year-end closing', () => {
  it('moves the year result to retained earnings, locks the period, keeps the P&L report', async () => {
    const before = await A.get('/api/reports/closing-preview?to=2025-12-31');
    expect(before.net_profit).toBeGreaterThan(0);
    const id = uuid();
    const r = await A.op({ type: 'year.close', id, date: '2025-12-31' });
    expect(r.status).toBe('accepted');
    // قائمة الدخل للسنة المقفلة تبقى كما هي (قيد الإقفال مستبعد)
    const is = await A.get('/api/reports/income-statement?from=2025-01-01&to=2025-12-31');
    expect(is.net_profit).toBe(before.net_profit);
    // حسابات الإيرادات والمصروفات صفر في ميزان المراجعة بعد الإقفال
    const tb = await A.get('/api/reports/trial-balance?to=2025-12-31');
    expect(tb.balanced).toBe(true);
    const sales = tb.accounts.find((a: any) => a.code === '41');
    expect(sales.closing).toBe(0);
    const retained = tb.accounts.find((a: any) => a.code === '32');
    expect(-retained.closing).toBe(before.net_profit);
    const bs = await A.get('/api/reports/balance-sheet?to=2025-12-31');
    expect(bs.balanced).toBe(true);
    expect(bs.current_profit).toBe(0);
    // الفترة مقفلة
    const late = await A.op(doc({ doc_type: 'expense', account_id: 'acc-5201', cashbox_id: 'cb-main', amount: 100, date: '2025-12-15' }));
    expect(late.status).toBe('rejected');
    // لا يمكن الإقفال مرتين لنفس الفترة
    const again = await A.op({ type: 'year.close', id: uuid(), date: '2025-12-31' });
    expect(again.status).toBe('rejected');
    // السنة الجديدة تبدأ من صفر
    const s26 = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', date: '2026-01-10', lines: [line(IT, 1, 10000)] }));
    expect(s26.status).toBe('accepted');
    const prev = await A.get('/api/reports/closing-preview?to=2026-12-31');
    expect(prev.from).toBe('2026-01-01');
    expect(prev.net_profit).toBe(5000);
  });

  it('cashier cannot close the year', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/admin/users', headers: A.headers, payload: { username: 'c4', full_name: 'c4', role_id: 'role-cashier', password: 'secret12' } });
    expect(res.statusCode).toBe(200);
    const C = await env.login('c4', 'secret12', 'device-c4-01');
    const r = await C.op({ type: 'year.close', id: uuid(), date: '2026-06-30' });
    expect(r.status).toBe('rejected');
  });
});
