import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { party, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;

beforeAll(async () => {
  env = await setup();
  A = await env.login();
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('customer types (party groups)', () => {
  it('ships default types and classifies the cash customer', async () => {
    const rows = (await env.db.query(`select id, name from party_groups order by sort`));
    expect(rows.map((r: any) => r.id)).toEqual(['pg-cash', 'pg-credit', 'pg-online']);
    const cash = (await env.db.one(`select group_id from parties where id = 'party-cash-customer'`));
    expect(cash.group_id).toBe('pg-cash');
  });

  it('adds and renames a type, links a customer to it, and syncs both', async () => {
    const r1 = await A.op({ type: 'master.upsert', entity: 'party_group', id: 'pg-test', base_version: null, data: { name: 'جملة', kind: 'customer', sort: 9 } });
    expect(r1.status).toBe('accepted');
    const r2 = await A.op(party('p5-cus', 'customer', 'P5', 'عميل جملة', { group_id: 'pg-test' }));
    expect(r2.status).toBe('accepted');
    const r3 = await A.op({ type: 'master.upsert', entity: 'party_group', id: 'pg-test', base_version: 1, data: { name: 'جملة كبار', kind: 'customer', sort: 9 } });
    expect(r3.status).toBe('accepted');
    const g = (await env.db.one(`select name, version from party_groups where id = 'pg-test'`));
    expect(g).toMatchObject({ name: 'جملة كبار', version: 2 });
    const p = (await env.db.one(`select group_id from parties where id = 'p5-cus'`));
    expect(p.group_id).toBe('pg-test');
    // نوع غير موجود يُرفض (مفتاح أجنبي)
    const bad = await A.op(party('p5-bad', 'customer', 'P5B', 'عميل خطأ', { group_id: 'pg-missing' }));
    expect(bad.status).not.toBe('accepted');
  });
});
