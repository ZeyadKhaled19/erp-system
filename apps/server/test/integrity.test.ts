import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportData, importData } from '../src/backup';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  expect((await A.op(item('ig-item', 'IG1', 'صنف الفحص'))).status).toBe('accepted');
  expect((await A.op(party('ig-cus', 'customer', 'IG-C', 'عميل الفحص'))).status).toBe('accepted');
  expect((await A.op(party('ig-sup', 'supplier', 'IG-S', 'مورد الفحص'))).status).toBe('accepted');
  expect((await A.op(doc({ doc_type: 'purchase_invoice', party_id: 'ig-sup', warehouse_id: 'wh-main', payment_type: 'credit', lines: [line('ig-item', 5, 4000)] }))).status).toBe('accepted');
  expect((await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line('ig-item', 1, 10000)] }))).status).toBe('accepted');
  const credit = await A.op(doc({ doc_type: 'sale_invoice', party_id: 'ig-cus', warehouse_id: 'wh-main', payment_type: 'credit', lines: [line('ig-item', 2, 10000)] }));
  expect(credit.status).toBe('accepted');
  expect((await A.op({ type: 'doc.cancel', id: credit.result.id, reason: 'اختبار الفحص' })).status).toBe('accepted');
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('data integrity', () => {
  it('reports everything consistent after normal posting and cancelling', async () => {
    const r = await A.get('/api/admin/integrity');
    expect(r.checks.map((c: any) => c.key)).toEqual(['balanced', 'parties', 'cashboxes', 'advances', 'stock', 'cancelled']);
    expect(r.checks.filter((c: any) => c.issues.length)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('blocks editing or deleting posted journal lines, entries and stock moves', async () => {
    await expect(env.db.exec(`update journal_lines set debit = debit + 1 where id = (select min(id) from journal_lines)`)).rejects.toThrow(/مرحّل/);
    await expect(env.db.exec(`delete from journal_lines where id = (select min(id) from journal_lines)`)).rejects.toThrow(/مرحّل/);
    await expect(env.db.exec(`update stock_moves set qty = 0 where id = (select min(id) from stock_moves)`)).rejects.toThrow(/مرحّل/);
    await expect(env.db.exec(`delete from stock_moves`)).rejects.toThrow(/مرحّل/);
    await expect(env.db.exec(`update journal_entries set memo = 'x' where number = (select min(number) from journal_entries)`)).rejects.toThrow(/مرحّل/);
    await expect(env.db.exec(`delete from journal_entries where number = (select min(number) from journal_entries)`)).rejects.toThrow(/مرحّل/);
  });

  it('rejects an unbalanced journal entry when the transaction commits', async () => {
    const acc = (await env.db.one(`select account_id from cashboxes where id = 'cb-main'`)).account_id;
    const before = (await env.db.one(`select count(*)::int as c from journal_entries`)).c;
    await expect(
      env.db.tx(async (t) => {
        await t.query(`insert into journal_entries (id, date, memo) values ('ig-bad', '2026-11-01', 'غير متوازن')`);
        await t.query(`insert into journal_lines (entry_id, account_id, debit, credit) values ('ig-bad', $1, 500, 0)`, [acc]);
      }),
    ).rejects.toThrow(/غير متوازن/);
    expect((await env.db.one(`select count(*)::int as c from journal_entries`)).c).toBe(before);
  });

  it('flags a stored balance that no longer matches the ledger', async () => {
    await env.db.exec(`update parties set balance = balance + 123 where id = 'ig-sup'`);
    await env.db.exec(`update stock_balances set qty = qty + 1000 where item_id = 'ig-item'`);
    const r = await A.get('/api/admin/integrity');
    expect(r.ok).toBe(false);
    const parties = r.checks.find((c: any) => c.key === 'parties');
    expect(parties.issues).toEqual([expect.objectContaining({ id: 'ig-sup', stored: expect.any(Number), computed: expect.any(Number) })]);
    expect(parties.issues[0].stored - parties.issues[0].computed).toBe(123);
    expect(r.checks.find((c: any) => c.key === 'stock').issues).toHaveLength(1);
    await env.db.exec(`update parties set balance = balance - 123 where id = 'ig-sup'`);
    await env.db.exec(`update stock_balances set qty = qty - 1000 where item_id = 'ig-item'`);
  });

  it('still restores a backup with the guards in place', async () => {
    const data = await exportData(env.db);
    await importData(env.db, data);
    expect((await A.get('/api/admin/integrity')).ok).toBe(true);
  });
});
