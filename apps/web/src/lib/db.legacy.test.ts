import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { db, setLocalIdentity } from './db';

// قبل فصل قاعدة كل موظف كانت هناك قاعدة واحدة «erp-local»؛ عملياتها غير المرفوعة يجب ألا تضيع
describe('legacy shared offline database', () => {
  it('moves the last signed-in user pending ops into their own outbox, and leaves other users alone', async () => {
    const owner = `legacy-owner-${crypto.randomUUID()}`;
    const other = `legacy-other-${crypto.randomUUID()}`;
    const legacy = new Dexie('erp-local');
    legacy.version(1).stores({ outbox: '++seq, op_id, status', meta: 'key' });
    await legacy.open();
    await legacy.table('meta').put({ key: 'last_user_id', value: owner });
    await legacy.table('outbox').bulkAdd([
      { op_id: 'pending-1', status: 'pending', created_at: '2026-11-13T00:00:00Z', op: { type: 'doc.post', id: 'd1', base_version: null }, attempts: 0 },
      { op_id: 'done-1', status: 'accepted', created_at: '2026-11-13T00:00:00Z', op: { type: 'doc.post', id: 'd2', base_version: null }, attempts: 1 },
    ]);
    legacy.close();

    // مستخدم آخر لا يأخذ عمليات غيره
    setLocalIdentity(other);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.outbox.count()).toBe(0);

    setLocalIdentity(owner);
    await new Promise((r) => setTimeout(r, 50));
    const moved = await db.outbox.toArray();
    expect(moved.map((e) => e.op_id)).toEqual(['pending-1']);
    expect(moved[0].owner_user_id).toBe(owner);

    const check = new Dexie('erp-local');
    check.version(1).stores({ outbox: '++seq, op_id, status', meta: 'key' });
    await check.open();
    expect(await check.table('outbox').where('status').equals('pending').count()).toBe(0);
    check.close();

    await db.delete();
    setLocalIdentity(other);
    await db.delete();
    setLocalIdentity(null);
    await Dexie.delete('erp-local');
  });
});
