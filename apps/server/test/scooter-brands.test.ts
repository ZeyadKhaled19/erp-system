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

describe('scooter brands', () => {
  it('adds a brand, links a customer to it, renames it, and rejects unknown brands', async () => {
    const r1 = await A.op({ type: 'master.upsert', entity: 'scooter_brand', id: 'sb-sym', base_version: null, data: { name: 'SYM', sort: 1 } });
    expect(r1.status).toBe('accepted');
    const r2 = await A.op(party('sb-cus', 'customer', 'SB1', 'عميل سكوتر', { scooter_brand_id: 'sb-sym' }));
    expect(r2.status).toBe('accepted');
    expect((await env.db.one(`select scooter_brand_id from parties where id = 'sb-cus'`)).scooter_brand_id).toBe('sb-sym');
    const r3 = await A.op({ type: 'master.upsert', entity: 'scooter_brand', id: 'sb-sym', base_version: 1, data: { name: 'SYM Motors', sort: 1 } });
    expect(r3.status).toBe('accepted');
    expect(await env.db.one(`select name, version from scooter_brands where id = 'sb-sym'`)).toMatchObject({ name: 'SYM Motors', version: 2 });
    // ماركة مش موجودة تُرفض (مفتاح أجنبي)
    const bad = await A.op(party('sb-bad', 'customer', 'SB2', 'عميل خطأ', { scooter_brand_id: 'sb-missing' }));
    expect(bad.status).not.toBe('accepted');
    // نفس الاسم مرتين مرفوض
    const dup = await A.op({ type: 'master.upsert', entity: 'scooter_brand', id: 'sb-dup', base_version: null, data: { name: 'SYM Motors', sort: 2 } });
    expect(dup.status).not.toBe('accepted');
  });
});
