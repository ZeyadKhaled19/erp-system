import { uuid } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, item, line, party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const ITEM = 'sales-cycle-item';
const CUSTOMER = 'sales-cycle-customer';

const stock = async () => env.db.one(`select qty, value from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [ITEM]);
const partyBalance = async () => (await env.db.one(`select balance from parties where id = $1`, [CUSTOMER])).balance;
const cashBalance = async () => (await env.db.one(`select balance from cashboxes where id = 'cb-main'`)).balance;

async function expectBalanced() {
  const r = await env.db.one(`
    select coalesce(sum(l.debit), 0)::bigint as debit, coalesce(sum(l.credit), 0)::bigint as credit
      from journal_lines l join journal_entries e on e.id = l.entry_id
  `);
  expect(r.debit).toBe(r.credit);
}

async function expectDocumentBalanced(documentId: string) {
  const entries = await env.db.query(`
    select e.id, coalesce(sum(l.debit), 0)::bigint as debit, coalesce(sum(l.credit), 0)::bigint as credit
      from journal_entries e join journal_lines l on l.entry_id = e.id
     where e.document_id = $1 group by e.id
  `, [documentId]);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) expect(entry.debit).toBe(entry.credit);
}

async function makeUser(username: string, role: string) {
  const r = await env.app.inject({ method: 'POST', url: '/api/admin/users', headers: A.headers, payload: { username, full_name: username, role_id: role, password: 'secret12' } });
  expect(r.statusCode).toBe(200);
  return env.login(username, 'secret12', `device-${username}-01`);
}

beforeAll(async () => {
  env = await setup();
  A = await env.login();
  const rs = await A.push([
    A.envelope(item(ITEM, 'SC-1', 'صنف دورة البيع', { sale_price: 10000 })),
    A.envelope(party(CUSTOMER, 'customer', 'SCC-1', 'عميل دورة البيع')),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(ITEM, 10, 4000)] })),
    A.envelope(doc({ doc_type: 'opening_stock', warehouse_id: 'wh-main', lines: [line(ITEM, 10, 6000)] })),
  ]);
  expect(rs.every((r) => r.status === 'accepted')).toBe(true);
  expect((await stock()).value).toBe(100000);
});

afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('sales posting cycle', () => {
  it('posts the 10,000 sale as 6,000 cash and 4,000 customer debt exactly once', async () => {
    const beforeStock = await stock();
    const beforeCash = await cashBalance();
    const beforeParty = await partyBalance();
    const operation = doc({
      doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main',
      lines: [line(ITEM, 1, 10000)],
      payments: [{ id: 'sales-cycle-split-payment', cashbox_id: 'cb-main', amount: 6000 }],
    });
    const envelope = A.envelope(operation);
    const [first] = await A.push([envelope]);
    const [retry] = await A.push([envelope]);

    expect(first.status).toBe('accepted');
    expect(retry).toEqual(first);
    const invoice = await env.db.one(`select total, paid, cost from documents where id = $1`, [first.result.id]);
    expect(invoice).toEqual({ total: 10000, paid: 6000, cost: 5000 });
    expect(await cashBalance() - beforeCash).toBe(6000);
    expect(await partyBalance() - beforeParty).toBe(4000);
    expect(await stock()).toEqual({ qty: beforeStock.qty - 1000, value: beforeStock.value - 5000 });
    expect(await env.db.query(`select id from document_payments where document_id = $1`, [first.result.id])).toHaveLength(1);
    expect(await env.db.query(`select id from journal_entries where document_id = $1`, [first.result.id])).toHaveLength(1);
    const cashAccount = (await env.db.one(`select account_id from cashboxes where id = 'cb-main'`)).account_id;
    const arAccount = (await env.db.one(`select id from accounts where system_key = 'ar'`)).id;
    const salesAccount = (await env.db.one(`select id from accounts where system_key = 'sales'`)).id;
    const cogsAccount = (await env.db.one(`select id from accounts where system_key = 'cogs'`)).id;
    const inventoryAccount = (await env.db.one(`select id from accounts where system_key = 'inventory'`)).id;
    const journal = await env.db.query(`
      select l.account_id, sum(l.debit)::bigint as debit, sum(l.credit)::bigint as credit
        from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.document_id = $1 group by l.account_id
    `, [first.result.id]);
    const byAccount = new Map(journal.map((row: any) => [row.account_id, row]));
    expect(byAccount.get(cashAccount)).toMatchObject({ debit: 6000, credit: 0 });
    expect(byAccount.get(arAccount)).toMatchObject({ debit: 10000, credit: 6000 });
    expect(byAccount.get(salesAccount)).toMatchObject({ debit: 0, credit: 10000 });
    expect(byAccount.get(cogsAccount)).toMatchObject({ debit: 5000, credit: 0 });
    expect(byAccount.get(inventoryAccount)).toMatchObject({ debit: 0, credit: 5000 });
    await expectDocumentBalanced(first.result.id);
    await expectBalanced();
  });

  it('records full cash sales and full credit sales with the expected balances', async () => {
    const cashBefore = await cashBalance();
    const debtBefore = await partyBalance();
    const cash = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(ITEM, 1, 10000)] }));
    expect(cash.status).toBe('accepted');
    expect(await cashBalance() - cashBefore).toBe(10000);
    expect(await partyBalance()).toBe(debtBefore);

    const credit = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    expect(credit.status).toBe('accepted');
    expect((await env.db.one(`select paid from documents where id = $1`, [credit.result.id])).paid).toBe(0);
    expect(await partyBalance() - debtBefore).toBe(10000);
    await expectBalanced();
  });

  it('returns goods at the original cost and reverses the invoice and return on cancellation', async () => {
    const before = await stock();
    const beforeParty = await partyBalance();
    const sale = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', payment_type: 'credit', lines: [line(ITEM, 1, 10000)] }));
    expect(sale.status).toBe('accepted');
    const saleLine = await env.db.one(`select id from document_lines where document_id = $1`, [sale.result.id]);
    const afterSale = await stock();
    expect(afterSale).toEqual({ qty: before.qty - 1000, value: before.value - 5000 });
    expect(await partyBalance() - beforeParty).toBe(10000);

    const ret = await A.op(doc({
      doc_type: 'sale_return', party_id: CUSTOMER, warehouse_id: 'wh-main', ref_doc_id: sale.result.id,
      lines: [line(ITEM, 1, 10000, { ref_line_id: saleLine.id })],
    }));
    expect(ret.status).toBe('accepted');
    expect(await stock()).toEqual(before);
    expect(await partyBalance()).toBe(beforeParty);

    expect((await A.op({ type: 'doc.cancel', id: ret.result.id, reason: 'اختبار عكس المرتجع' })).status).toBe('accepted');
    expect(await stock()).toEqual(afterSale);
    expect(await partyBalance() - beforeParty).toBe(10000);
    expect((await A.op({ type: 'doc.cancel', id: sale.result.id, reason: 'اختبار إلغاء البيع' })).status).toBe('accepted');
    expect(await stock()).toEqual(before);
    expect(await partyBalance()).toBe(beforeParty);
    await expectBalanced();
  });

  it('does not silently post duplicate payment IDs', async () => {
    const beforeCash = await cashBalance();
    const beforeStock = await stock();
    const repeatedId = uuid();
    const repeated = doc({
      id: repeatedId, doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main',
      lines: [line(ITEM, 1, 10000)],
      payments: [
        { id: 'sales-cycle-duplicate-payment', cashbox_id: 'cb-main', amount: 1000 },
        { id: 'sales-cycle-duplicate-payment', cashbox_id: 'cb-main', amount: 1000 },
      ],
    });
    const sameDocument = await A.op(repeated);
    expect(sameDocument.status).toBe('rejected');
    expect(sameDocument.message).toContain('معرف دفعة مكرر');
    expect(await env.db.one(`select id from documents where id = $1`, [repeatedId])).toBeUndefined();
    expect(await cashBalance()).toBe(beforeCash);
    expect(await stock()).toEqual(beforeStock);

    const paymentId = 'sales-cycle-cross-document-payment';
    const first = await A.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', lines: [line(ITEM, 1, 10000)], payments: [{ id: paymentId, cashbox_id: 'cb-main', amount: 1000 }] }));
    expect(first.status).toBe('accepted');
    const cashAfterFirst = await cashBalance();
    const secondId = uuid();
    const secondDoc = doc({ id: secondId, doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', lines: [line(ITEM, 1, 10000)], payments: [{ id: paymentId, cashbox_id: 'cb-main', amount: 1000 }] });
    const second = await A.op(secondDoc);
    expect(second.status).toBe('rejected');
    expect(second.message).toContain('معرف الدفعة مستخدم');
    expect(await env.db.one(`select id from documents where id = $1`, [secondId])).toBeUndefined();
    expect(await cashBalance()).toBe(cashAfterFirst);
    await expectBalanced();
  });

  it('routes a stock shortage to review without mutating balances', async () => {
    const shortageItem = uuid();
    expect((await A.op(item(shortageItem, 'SC-SHORT', 'صنف بلا مخزون', { sale_price: 1000 }))).status).toBe('accepted');
    const beforeCash = await cashBalance();
    const sale = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(shortageItem, 1, 1000)] }));
    expect(sale.status).toBe('conflict');
    expect(sale.result.status).toBe('pending_review');
    expect(await env.db.one(`select qty from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [shortageItem])).toBeUndefined();
    expect(await cashBalance()).toBe(beforeCash);
  });

  it('allows negative stock only when the setting is enabled', async () => {
    const negativeItem = uuid();
    expect((await A.op(item(negativeItem, 'SC-NEG', 'صنف بالسالب', { sale_price: 1000 }))).status).toBe('accepted');
    const settings = await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { allow_negative_stock: true } });
    expect(settings.statusCode).toBe(200);
    try {
      const sale = await A.op(doc({ doc_type: 'sale_invoice', warehouse_id: 'wh-main', cashbox_id: 'cb-main', payment_type: 'cash', lines: [line(negativeItem, 1, 1000)] }));
      expect(sale.status).toBe('accepted');
      expect((await env.db.one(`select qty from stock_balances where item_id = $1 and warehouse_id = 'wh-main'`, [negativeItem])).qty).toBe(-1000);
      await expectBalanced();
    } finally {
      await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { allow_negative_stock: false } });
    }
  });

  it('rejects posting when the user lacks sales.post', async () => {
    const role = 'role-sales-create-only';
    const createdRole = await env.app.inject({
      method: 'POST', url: '/api/admin/roles', headers: A.headers,
      payload: { id: role, name: 'إنشاء بيع دون ترحيل', permissions: ['sales.create', 'sales.view', 'sales.credit', 'items.view', 'parties.view', 'warehouses.view', 'treasury.view'] },
    });
    expect(createdRole.statusCode).toBe(200);
    const user = await makeUser('salesdraft', role);
    const draft = await user.op(doc({ doc_type: 'sale_invoice', party_id: CUSTOMER, warehouse_id: 'wh-main', lines: [line(ITEM, 1, 10000)] }, 'draft'));
    expect(draft.status).toBe('accepted');
    expect((await user.op({ type: 'doc.post', id: draft.result.id, base_version: null })).status).toBe('rejected');
    expect((await env.db.one(`select status from documents where id = $1`, [draft.result.id])).status).toBe('draft');
  });
});
