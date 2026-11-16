import { MIGRATIONS } from '../src/migrations.bundle';
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

const custom = async (id: string) => {
  const c = (await env.db.one(`select custom from parties where id = $1`, [id])).custom;
  return typeof c === 'string' ? JSON.parse(c) : c;
};

describe('party fields (custom customer fields)', () => {
  it('a fresh system has no motorcycle field', async () => {
    expect((await env.db.query(`select id from party_fields`)).length).toBe(0);
  });

  it('adds a list field and a text field, saves values on a customer, and cleans empty values', async () => {
    const f1 = await A.op({ type: 'master.upsert', entity: 'party_field', id: 'pf-model', base_version: null, data: { name: 'الموديل', kind: 'list', applies_to: 'customer', options: [{ id: 'o-1', name: '2023' }, { id: 'o-2', name: '2024' }], sort: 1 } });
    expect(f1.status).toBe('accepted');
    const f2 = await A.op({ type: 'master.upsert', entity: 'party_field', id: 'pf-plate', base_version: null, data: { name: 'رقم اللوحة', kind: 'text', applies_to: 'both', sort: 2 } });
    expect(f2.status).toBe('accepted');
    const row = await env.db.one(`select options from party_fields where id = 'pf-model'`);
    const opts = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
    expect(opts.map((o: any) => o.name)).toEqual(['2023', '2024']);

    const r = await A.op(party('pf-cus', 'customer', 'PF1', 'عميل خانات', { custom: { 'pf-model': 'o-2', 'pf-plate': ' ص ع 123 ', 'pf-empty': '' } }));
    expect(r.status).toBe('accepted');
    expect(await custom('pf-cus')).toEqual({ 'pf-model': 'o-2', 'pf-plate': 'ص ع 123' });
  });

  it('rejects the same option name twice in one field', async () => {
    const r = await A.op({ type: 'master.upsert', entity: 'party_field', id: 'pf-dup', base_version: null, data: { name: 'مكرر', options: [{ id: 'd1', name: 'SYM' }, { id: 'd2', name: 'sym' }] } });
    expect(r.status).not.toBe('accepted');
  });

  it('moves old scooter brands into a «ماركة السكوتر» field, and an old device that still sends the brand keeps it in sync', async () => {
    expect((await A.op({ type: 'master.upsert', entity: 'scooter_brand', id: 'sb-sym', base_version: null, data: { name: 'SYM', sort: 1 } })).status).toBe('accepted');
    expect((await A.op(party('pf-old', 'customer', 'PF2', 'عميل قديم', { scooter_brand_id: 'sb-sym' }))).status).toBe('accepted');
    // نعيد تشغيل جزء النقل من الميجريشن على البيانات دي
    const sql = MIGRATIONS.find((m) => m.name === '014_party_fields.sql')!.sql;
    await env.db.exec(sql.slice(sql.indexOf('INSERT INTO party_fields')));
    const f = await env.db.one(`select name, options from party_fields where id = 'pf-scooter-brand'`);
    expect(f.name).toBe('ماركة السكوتر');
    expect((typeof f.options === 'string' ? JSON.parse(f.options) : f.options).map((o: any) => o.id)).toEqual(['sb-sym']);
    expect((await custom('pf-old'))['pf-scooter-brand']).toBe('sb-sym');

    // جهاز قديم بيعدّل العميل وبيبعت scooter_brand_id بس
    expect((await A.op({ type: 'master.upsert', entity: 'scooter_brand', id: 'sb-honda', base_version: null, data: { name: 'Honda', sort: 2 } })).status).toBe('accepted');
    const v = (await env.db.one(`select version from parties where id = 'pf-old'`)).version;
    const old = party('pf-old', 'customer', 'PF2', 'عميل قديم', { scooter_brand_id: 'sb-honda' }) as any;
    old.base_version = v;
    expect((await A.op(old)).status).toBe('accepted');
    expect((await custom('pf-old'))['pf-scooter-brand']).toBe('sb-honda');
  });
});
