import Dexie, { type Table } from 'dexie';
import type { Op, OpStatus } from '@erp/shared';

/**
 * قاعدة البيانات المحلية (IndexedDB):
 * - نسخة من البيانات المركزية التي يحتاجها الجهاز (تُحدّث بالسحب التزايدي)
 * - السجلات التي أُنشئت/عُدلت على الجهاز ولم تُقبل مركزيًا بعد تحمل _sync
 * - طابور العمليات outbox بالترتيب
 * تبقى كلها بعد إغلاق البرنامج أو إعادة تشغيل الجهاز.
 */

/** حالة المزامنة المحلية لسجل: غير موجودة = مطابق للخادم */
export type LocalSync = 'pending' | 'rejected' | 'conflict' | undefined;

export interface Row {
  id: string;
  row_version?: number;
  _sync?: LocalSync;
  _error?: string;
  [k: string]: any;
}

export interface OutboxEntry {
  seq?: number;
  op_id: string;
  owner_user_id?: string;
  created_at: string;
  op: Op;
  status: 'pending' | OpStatus;
  label: string;
  entity: string;
  entity_id: string;
  attempts: number;
  message?: string;
  result?: Record<string, unknown>;
  sent_at?: string;
  done_at?: string;
}

class LocalDb extends Dexie {
  settings!: Table<{ key: string; value: any; row_version?: number }, string>;
  roles!: Table<Row, string>;
  users!: Table<Row, string>;
  accounts!: Table<Row, string>;
  warehouses!: Table<Row, string>;
  categories!: Table<Row, string>;
  items!: Table<Row, string>;
  item_units!: Table<Row, string>;
  stock_balances!: Table<Row & { item_id: string; warehouse_id: string; qty: number; value: number }, [string, string]>;
  parties!: Table<Row, string>;
  cashboxes!: Table<Row, string>;
  documents!: Table<Row, string>;
  document_lines!: Table<Row, string>;
  sync_conflicts!: Table<Row, string>;
  instruments!: Table<Row, string>;
  price_lists!: Table<Row, string>;
  item_prices!: Table<Row, string>;
  sales_reps!: Table<Row, string>;
  partners!: Table<Row, string>;
  cashier_shifts!: Table<Row, string>;
  party_groups!: Table<Row, string>;
  employees!: Table<Row, string>;
  attendance!: Table<Row, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor(name = 'erp-local') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      roles: 'id',
      users: 'id',
      accounts: 'id, code, parent_id, system_key',
      warehouses: 'id, code',
      categories: 'id, name',
      items: 'id, code, name, barcode, category_id, _sync',
      item_units: 'id, item_id, barcode',
      stock_balances: '[item_id+warehouse_id], item_id, warehouse_id',
      parties: 'id, kind, code, name, _sync',
      cashboxes: 'id, account_id',
      documents: 'id, doc_type, date, party_id, status, number, ref_doc_id, _sync, [doc_type+date]',
      document_lines: 'id, document_id, item_id',
      sync_conflicts: 'id, status, entity_id',
      outbox: '++seq, &op_id, status, entity_id',
      meta: 'key',
    });
    this.version(2).stores({
      instruments: 'id, party_id, document_id, status, due_date',
      price_lists: 'id, sort',
      item_prices: 'id, item_id, [item_id+unit_name+price_list_id]',
      sales_reps: 'id, name',
      partners: 'id, name',
      cashier_shifts: 'id, user_id, status',
    }).upgrade(async (tx) => {
      // جداول جديدة على الخادم: سحب كامل لضمان وصول كل بياناتها
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    this.version(3).stores({
      party_groups: 'id, kind, sort',
      parties: 'id, kind, code, name, group_id, _sync',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    // قسم الموظفين: الموظفون والحضور اليومي
    this.version(4).stores({
      employees: 'id, name, active',
      attendance: 'id, employee_id, date, [employee_id+date]',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
  }
}

let localIdentity = 'anonymous';
const localDatabases = new Map<string, LocalDb>();
function activeLocalDb() {
  let instance = localDatabases.get(localIdentity);
  if (!instance) {
    instance = new LocalDb(`erp-local:${localIdentity}`);
    localDatabases.set(localIdentity, instance);
  }
  return instance;
}

/** Select a separate offline database and outbox for each signed-in employee. */
export function setLocalIdentity(userId: string | null | undefined) {
  localIdentity = userId ? encodeURIComponent(userId) : 'anonymous';
  activeLocalDb();
  if (userId) void migrateLegacyOutbox(userId);
}

/**
 * ترحيل لمرة واحدة من قاعدة الجهاز القديمة المشتركة («erp-local»):
 * العمليات التي لم تُرفع بعد كانت لآخر مستخدم دخل على الجهاز (النظام القديم كان يمنع غيره من الدخول قبل رفعها)،
 * فتُنقل نسخة منها إلى طابور ذلك المستخدم حتى تُرفع ولا تضيع. القاعدة القديمة لا يُحذف منها شيء:
 * العمليات المنقولة تُعلَّم فقط بحالة «migrated» حتى لا تُنقل مرتين، وتبقى للمراجعة.
 */
const legacyChecked = new Set<string>();
async function migrateLegacyOutbox(userId: string) {
  if (legacyChecked.has(userId)) return;
  legacyChecked.add(userId);
  try {
    if (!(await Dexie.exists('erp-local'))) return;
    const legacy = new LocalDb('erp-local');
    try {
      const pending = await legacy.outbox.where('status').equals('pending').toArray();
      if (!pending.length) return;
      const owner = (await legacy.meta.get('last_user_id'))?.value ?? null;
      if (owner !== userId) return;
      const target = activeLocalDb();
      const known = new Set((await target.outbox.toArray()).map((e) => e.op_id));
      const moving = pending.filter((e) => !known.has(e.op_id));
      await target.outbox.bulkAdd(moving.map(({ seq: _seq, ...e }) => ({ ...e, owner_user_id: userId })) as OutboxEntry[]);
      await legacy.outbox.bulkUpdate(pending.filter((e) => e.seq !== undefined).map((e) => ({ key: e.seq!, changes: { status: 'migrated', migrated_to: userId, migrated_at: new Date().toISOString() } as any })));
      console.info(`نُقلت ${moving.length} عملية غير مرفوعة من قاعدة الجهاز القديمة`);
    } finally {
      legacy.close();
    }
  } catch (e) {
    legacyChecked.delete(userId);
    console.warn('تعذر نقل العمليات القديمة غير المرفوعة', e);
  }
}

export function getLocalIdentity() {
  return localIdentity === 'anonymous' ? null : decodeURIComponent(localIdentity);
}

// Keep the existing `db.table` call sites intact while routing them to the active employee DB.
export const db = new Proxy(new LocalDb('erp-local:anonymous'), {
  get(_target, property) {
    const instance = activeLocalDb() as any;
    const value = instance[property];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
}) as LocalDb;

export async function getMeta<T = any>(key: string, def?: T): Promise<T> {
  const r = await db.meta.get(key);
  return (r?.value ?? def) as T;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export const SYNCED_TABLE_NAMES = [
  'settings', 'roles', 'users', 'accounts', 'warehouses', 'categories', 'items', 'item_units',
  'stock_balances', 'parties', 'cashboxes', 'documents', 'document_lines', 'sync_conflicts',
  'instruments', 'price_lists', 'item_prices', 'sales_reps', 'partners', 'cashier_shifts', 'party_groups',
  'employees', 'attendance',
] as const;
