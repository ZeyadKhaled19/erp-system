import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, setLocalIdentity } from './db';

describe('employee-local offline storage boundary', () => {
  const userA = `security-test-a-${crypto.randomUUID()}`;
  const userB = `security-test-b-${crypto.randomUUID()}`;

  afterAll(async () => {
    setLocalIdentity(userA);
    await db.delete();
    setLocalIdentity(userB);
    await db.delete();
    setLocalIdentity(null);
  });

  it('keeps synced rows and pending operations in the owner employee database', async () => {
    setLocalIdentity(userA);
    await db.parties.put({ id: 'private-a', name: 'A' });
    await db.outbox.add({
      owner_user_id: userA, op_id: 'op-private-a', created_at: new Date().toISOString(),
      op: { type: 'doc.post', id: 'private-a', base_version: 1 } as any,
      status: 'pending', label: 'فاتورة', entity: 'document', entity_id: 'private-a', attempts: 0,
    });

    setLocalIdentity(userB);
    expect(await db.parties.get('private-a')).toBeUndefined();
    expect(await db.outbox.where('status').equals('pending').toArray()).toEqual([]);

    setLocalIdentity(userA);
    expect(await db.parties.get('private-a')).toMatchObject({ id: 'private-a' });
    expect(await db.outbox.where('status').equals('pending').toArray()).toHaveLength(1);
  });
});
