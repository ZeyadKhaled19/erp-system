import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uuid, type Op } from '@erp/shared';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

export async function setup() {
  // TEST_DATABASE_URL يشغّل نفس الاختبارات على PostgreSQL حقيقي (تُمسح قاعدة الاختبار بالكامل)
  const url = process.env.TEST_DATABASE_URL;
  const db = await openDb(url ? { url } : { memory: true });
  if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SEQUENCE IF EXISTS sync_seq;');
  const backupDir = await mkdtemp(path.join(os.tmpdir(), 'erp-test-'));
  await migrate(db, { backupDir });
  await seed(db, { adminPassword: 'admin123' });
  const app = await buildApp({ db, jwtSecret: 'test-secret', backupDir });

  async function login(username = 'admin', password = 'admin123', deviceId = 'device-A-0001') {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password, device_id: deviceId } });
    if (r.statusCode !== 200) throw new Error('login failed: ' + r.body);
    const token = r.json().token as string;
    let seq = 0;
    const headers = { authorization: `Bearer ${token}`, 'x-device-id': deviceId };
    return {
      token,
      headers,
      envelope(op: Op, opId = uuid()) {
        return { op_id: opId, seq: seq++, created_at: new Date().toISOString(), op };
      },
      async push(envs: any[]) {
        const res = await app.inject({ method: 'POST', url: '/api/sync/push', headers, payload: { ops: envs } });
        if (res.statusCode !== 200) throw new Error('push failed: ' + res.body);
        return res.json().results as any[];
      },
      async op(op: Op) {
        const [r] = await this.push([this.envelope(op)]);
        return r;
      },
      async get(url: string) {
        const res = await app.inject({ method: 'GET', url, headers });
        if (res.statusCode !== 200) throw new Error(`GET ${url} → ${res.statusCode}: ${res.body}`);
        return res.json();
      },
    };
  }
  return { db, app, backupDir, login };
}

export type Client = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['login']>>;

export const item = (id: string, code: string, name: string, extra: Record<string, unknown> = {}): Op => ({
  type: 'master.upsert',
  entity: 'item',
  id,
  base_version: null,
  data: { code, name, base_unit: 'قطعة', sale_price: 10000, tax_rate_bp: 0, ...extra },
});

export const party = (id: string, kind: 'customer' | 'supplier', code: string, name: string, extra: Record<string, unknown> = {}): Op => ({
  type: 'master.upsert',
  entity: 'party',
  id,
  base_version: null,
  data: { kind, code, name, ...extra },
});

export function doc(d: Record<string, any>, action: 'post' | 'draft' = 'post'): Op {
  return {
    type: 'doc.save',
    action,
    base_version: null,
    doc: { id: uuid(), date: '2026-11-01', lines: [], journal_lines: [], paid: 0, amount: 0, discount: 0, ...d } as any,
  };
}

export const line = (item_id: string, qty: number, price: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  item_id,
  unit_name: 'قطعة',
  unit_factor: 1000,
  qty: qty * 1000,
  price,
  discount: 0,
  tax_rate_bp: 0,
  ...extra,
});
