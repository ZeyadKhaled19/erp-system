import { SYNC_TABLES, uuid, type Op, type OpResult } from '@erp/shared';
import { api, ApiError } from './api';
import { db, getLocalIdentity, getMeta, setMeta, SYNCED_TABLE_NAMES, type OutboxEntry } from './db';

/**
 * محرك المزامنة:
 * 1) كل كتابة تُحفظ محليًا فورًا + تُضاف لطابور outbox في معاملة IndexedDB واحدة.
 * 2) عند وجود اتصال تُرسل العمليات بالترتيب (دفعات). نفس op_id عند إعادة الإرسال لا يُكرر شيئًا على الخادم.
 * 3) بعد الإرسال نسحب التغييرات المركزية الأحدث من آخر cursor.
 * 4) العمليات المرفوضة أو المتعارضة تبقى ظاهرة في مركز المزامنة مع السبب وخيارات المعالجة.
 */

type Listener = () => void;
export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  serverReachable: boolean;
}

let state: SyncState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  serverReachable: true,
};
const listeners = new Set<Listener>();
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const syncStore = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let enabled = false;
let running: Promise<void> | null = null;
let runningOwner: string | null = null;
let again = false;
let seqCounter = 0;

// ---------------------------------------------------------------- الكتابة المحلية

export interface EnqueueOpts {
  label: string;
  entity: string;
  entity_id: string;
  /** الكتابة المحلية المتفائلة: تُنفذ في نفس معاملة إضافة العملية */
  apply?: () => Promise<void>;
}

export async function enqueue(op: Op, o: EnqueueOpts): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    op_id: uuid(),
    owner_user_id: getLocalIdentity() ?? undefined,
    created_at: new Date().toISOString(),
    op,
    status: 'pending',
    label: o.label,
    entity: o.entity,
    entity_id: o.entity_id,
    attempts: 0,
  };
  await db.transaction('rw', db.tables, async () => {
    if (o.apply) await o.apply();
    await db.outbox.add(entry);
  });
  void syncNow();
  return entry;
}

/** رقم محلي مؤقت للمستند حتى يعطيه الخادم رقمه الرسمي */
export async function nextLocalNumber(): Promise<string> {
  const n = (await getMeta<number>('local_doc_counter', 0)) + 1;
  await setMeta('local_doc_counter', n);
  const dev = (await getMeta<string>('device_short', '')) || 'ج';
  return `TMP-${dev}-${n}`;
}

// ---------------------------------------------------------------- الإرسال

const TABLE_OF: Record<string, keyof typeof db | undefined> = {
  item: 'items',
  party: 'parties',
  warehouse: 'warehouses',
  category: 'categories',
  cashbox: 'cashboxes',
  account: 'accounts',
  document: 'documents',
  sales_rep: 'sales_reps',
  price_list: 'price_lists',
  partner: 'partners',
  party_group: 'party_groups',
  employee: 'employees',
  attendance: 'attendance',
  instrument: 'instruments',
  shift: 'cashier_shifts',
};

async function markEntity(entry: OutboxEntry, r: OpResult) {
  const tableName = TABLE_OF[entry.entity];
  if (!tableName) return;
  const table = (db as any)[tableName];
  const row = await table.get(entry.entity_id);
  if (!row) return;
  // هل توجد عمليات أحدث معلقة على نفس السجل؟ إن وجدت يبقى «بانتظار المزامنة»
  const laterPending = await db.outbox
    .where('entity_id')
    .equals(entry.entity_id)
    .filter((e) => e.status === 'pending' && e.op_id !== entry.op_id)
    .count();
  const patch: Record<string, unknown> = {};
  if (r.status === 'accepted') {
    patch._sync = laterPending ? 'pending' : undefined;
    patch._error = undefined;
    const res = r.result ?? {};
    if (res.number) patch.number = res.number;
    if (res.status) patch.status = res.status;
  } else if (r.status === 'conflict') {
    patch._sync = 'conflict';
    patch._error = r.message;
    if (r.result?.status) patch.status = r.result.status;
    if (r.result?.number) patch.number = r.result.number;
  } else {
    patch._sync = 'rejected';
    patch._error = r.message;
  }
  await table.update(entry.entity_id, patch);
}

async function pushOutbox(owner: string): Promise<void> {
  for (;;) {
    if (getLocalIdentity() !== owner) return;
    const batch = await db.outbox.where('status').equals('pending').filter((entry) => entry.owner_user_id === owner).sortBy('seq');
    if (getLocalIdentity() !== owner) return;
    if (!batch.length) return;
    const slice = batch.slice(0, 50);
    const payload = slice.map((e) => ({ op_id: e.op_id, seq: e.seq ?? seqCounter++, created_at: e.created_at, op: e.op }));
    await db.outbox.bulkUpdate(slice.map((e) => ({ key: e.seq!, changes: { attempts: e.attempts + 1, sent_at: new Date().toISOString() } })));
    if (getLocalIdentity() !== owner) return;
    // إذا انقطع الاتصال هنا تبقى العمليات pending وتُرسل بنفس op_id لاحقًا دون تكرار
    const res = await api<{ results: OpResult[] }>('/api/sync/push', { body: { ops: payload }, timeoutMs: 60000 });
    if (getLocalIdentity() !== owner) return;
    let stop = false;
    for (const r of res.results) {
      const entry = slice.find((e) => e.op_id === r.op_id);
      if (!entry) continue;
      if (r.retry) {
        await db.outbox.update(entry.seq!, { message: r.message });
        stop = true;
        break;
      }
      await db.transaction('rw', db.tables, async () => {
        await db.outbox.update(entry.seq!, { status: r.status, message: r.message, result: r.result, done_at: new Date().toISOString() });
        await markEntity(entry, r);
      });
    }
    if (stop) throw new ApiError('الخادم طلب إعادة المحاولة لاحقًا', 503, true);
  }
}

// ---------------------------------------------------------------- السحب

async function pendingIds(): Promise<Set<string>> {
  const p = await db.outbox.where('status').equals('pending').toArray();
  return new Set(p.map((e) => e.entity_id));
}

export async function applyChanges(changes: Record<string, any[]>, owner?: string) {
  if (owner && getLocalIdentity() !== owner) return;
  const pending = await pendingIds();
  if (owner && getLocalIdentity() !== owner) return;
  await db.transaction('rw', db.tables, async () => {
    for (const table of SYNC_TABLES) {
      const rows = changes[table];
      if (!rows?.length) continue;
      const t = (db as any)[table];
      if (table === 'stock_balances' || table === 'settings') {
        await t.bulkPut(rows);
        continue;
      }
      if (table === 'document_lines') {
        await t.bulkPut(rows.filter((r) => !pending.has(r.document_id)));
        continue;
      }
      // لا نكتب فوق سجل محلي له عملية لم تُرسل بعد
      const toPut = rows.filter((r) => !pending.has(r.id));
      if (table === 'documents') {
        for (const d of toPut) {
          // السطور التي حُذفت من مسودة على الخادم تُحذف محليًا؛ الخادم يرسل قائمة السطور الحالية لكل مستند
          if (Array.isArray(d.line_ids)) {
            const keep = new Set<string>(d.line_ids);
            await db.document_lines.where('document_id').equals(d.id).filter((l) => !keep.has(l.id)).delete();
          }
          delete d.line_ids;
        }
      }
      await t.bulkPut(toPut);
    }
  });
}

async function pullChanges(owner: string): Promise<void> {
  let cursor = await getMeta<number>('cursor', 0);
  const localEpoch = await getMeta<string | null>('epoch', null);
  for (;;) {
    if (getLocalIdentity() !== owner) return;
    const r = await api<{ cursor: number; more: boolean; epoch: string; changes: Record<string, any[]> }>(`/api/sync/pull?cursor=${cursor}`, {
      timeoutMs: 60000,
    });
    if (getLocalIdentity() !== owner) return;
    if (localEpoch && r.epoch && localEpoch !== r.epoch && cursor !== 0) {
      // تمت استعادة نسخة احتياطية على الخادم: نعيد بناء النسخة المحلية بالكامل مع الإبقاء على العمليات غير المرسلة
      await db.transaction('rw', db.tables, async () => {
        for (const t of SYNCED_TABLE_NAMES) await (db as any)[t].clear();
      });
      await setMeta('cursor', 0);
      await setMeta('epoch', r.epoch);
      cursor = 0;
      continue;
    }
    await applyChanges(r.changes, owner);
    cursor = r.cursor;
    await setMeta('cursor', cursor);
    if (r.epoch) await setMeta('epoch', r.epoch);
    if (!r.more) break;
  }
}

// ---------------------------------------------------------------- الحلقة

export async function syncNow(): Promise<void> {
  if (!enabled) return;
  const owner = getLocalIdentity();
  if (!owner) return;
  if (running) {
    if (runningOwner === owner) again = true;
    return running;
  }
  runningOwner = owner;
  running = (async () => {
    setState({ syncing: true });
    try {
      do {
        again = false;
        if (getLocalIdentity() !== owner) break;
        await pushOutbox(owner);
        await pullChanges(owner);
      } while (again && getLocalIdentity() === owner);
      if (getLocalIdentity() === owner) {
        setState({ lastSyncAt: new Date().toISOString(), lastError: null, serverReachable: true, online: true });
        await setMeta('last_sync_at', new Date().toISOString());
      }
    } catch (e) {
      if (getLocalIdentity() === owner) {
        const err = e as ApiError;
        setState({ lastError: err.message, serverReachable: !err.network, online: navigator.onLine && !err.network ? true : navigator.onLine });
      }
    } finally {
      setState({ syncing: false });
      running = null;
      runningOwner = null;
      if (enabled && getLocalIdentity() && getLocalIdentity() !== owner) void syncNow();
    }
  })();
  return running;
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startSync() {
  if (enabled) return;
  enabled = true;
  const kick = () => void syncNow();
  window.addEventListener('online', () => {
    setState({ online: true });
    kick();
  });
  window.addEventListener('offline', () => setState({ online: false, serverReachable: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
  timer = setInterval(kick, 15000);
  void (async () => {
    setState({ lastSyncAt: await getMeta('last_sync_at', null) });
    kick();
  })();
}

export function stopSync() {
  enabled = false;
  if (timer) clearInterval(timer);
  timer = null;
}

/** إعادة محاولة عملية مرفوضة لا تُعاد بنفس op_id (الخادم سيعيد نفس الرفض)؛ لذلك ننشئ عملية جديدة بعد تعديل البيانات */
export async function discardOutboxEntry(seq: number) {
  const e = await db.outbox.get(seq);
  if (!e) return;
  await db.transaction('rw', db.tables, async () => {
    await db.outbox.update(seq, { status: 'rejected', message: (e.message ?? '') + ' — تم تجاهلها' });
    // سجل محلي لم يصل للخادم أبدًا يُزال من العرض
    const tableName = TABLE_OF[e.entity];
    if (tableName && e.op.type !== 'doc.cancel') {
      const t = (db as any)[tableName];
      const row = await t.get(e.entity_id);
      if (row && (row._sync === 'rejected' || row._sync === 'pending') && !row.row_version) {
        await t.delete(e.entity_id);
        if (tableName === 'documents') await db.document_lines.where('document_id').equals(e.entity_id).delete();
      } else if (row && row.row_version) {
        await t.update(e.entity_id, { _sync: undefined, _error: undefined });
      }
    }
    await db.outbox.update(seq, { message: 'تم التجاهل' });
  });
  // سحب كامل يعيد النسخة المركزية للسجلات التي عدلناها محليًا
  await setMeta('cursor', 0);
  void syncNow();
}

export async function clearLocalData() {
  stopSync();
  await db.delete();
}
