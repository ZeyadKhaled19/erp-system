import { SYNC_TABLES, type SyncTable } from '@erp/shared';
import type { Db } from './db';

const WINDOW = 5000;

/** الأعمدة المسحوبة لكل جدول (لا نرسل كلمات المرور أبدًا) */
const SELECT: Partial<Record<SyncTable, string>> = {
  users: 'id, username, full_name, role_id, active, warehouse_ids, cashbox_ids, row_version',
  documents: `*, (select coalesce(json_agg(l.id), '[]'::json) from document_lines l where l.document_id = documents.id) as line_ids`,
};

/**
 * السحب التزايدي: كل صف له row_version من تسلسل عام واحد.
 * الجهاز يرسل آخر cursor وصله ونعيد كل الصفوف الأحدث على نوافذ متتالية.
 * القفل المشترك ينتظر انتهاء أي معاملة كتابة جارية حتى لا نتخطى صفًا لم يُحفظ بعد.
 */
export async function pull(db: Db, cursor: number) {
  return db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock_shared(7331)`);
    const seq = await t.one<{ v: number }>(`select last_value::bigint as v from sync_seq`);
    const max = seq?.v ?? 0;
    const upto = Math.min(max, cursor + WINDOW);
    const changes: Record<string, any[]> = {};
    for (const table of SYNC_TABLES) {
      const rows = await t.query(
        `select ${SELECT[table] ?? '*'} from ${table} where row_version > $1 and row_version <= $2 order by row_version`,
        [cursor, upto],
      );
      if (rows.length) changes[table] = rows;
    }
    const epoch = (await t.one(`select value from settings where key = 'db_epoch'`))?.value ?? null;
    return { cursor: upto, more: upto < max, epoch, changes, server_time: new Date().toISOString() };
  });
}
