import { DOC_TYPES, SYNC_TABLES, hasPermission, type SyncTable } from '@erp/shared';
import type { AuthUser } from './auth';
import type { Db } from './db';

const WINDOW = 5000;
const SELECT: Partial<Record<SyncTable, string>> = {
  users: 'id, username, full_name, role_id, active, warehouse_ids, cashbox_ids, extra_permissions, denied_permissions, row_version',
  documents: `*, (select coalesce(json_agg(l.id), '[]'::json) from document_lines l where l.document_id = documents.id) as line_ids`,
};

const modulePermission: Record<string, string> = {
  sales: 'sales.view',
  purchases: 'purchases.view',
  inventory: 'inventory.view',
  treasury: 'treasury.view',
  accounts: 'accounts.view',
  partners: 'partners.view',
  employees: 'employees.view',
};
const can = (user: AuthUser, permission: string) => hasPermission(user.permissions, permission);
const inScope = (ids: string[] | null, id: string | null | undefined) => !id || !ids || ids.includes(id);

function documentVisible(row: any, user: AuthUser) {
  const type = DOC_TYPES[row.doc_type as keyof typeof DOC_TYPES];
  if (!type || !can(user, modulePermission[type.module] ?? '')) return false;
  if (!inScope(user.warehouse_ids, row.warehouse_id) || !inScope(user.warehouse_ids, row.to_warehouse_id)) return false;
  if (!inScope(user.cashbox_ids, row.cashbox_id)) return false;
  const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data ?? {};
  for (const payment of data.payments ?? []) if (!inScope(user.cashbox_ids, payment.cashbox_id)) return false;
  if (!can(user, 'costs.view')) {
    delete row.cost;
    if (row.data && typeof row.data === 'object') {
      delete row.data.cost;
      delete row.data.costs;
    }
  }
  return true;
}

function visible(table: SyncTable, row: any, user: AuthUser) {
  switch (table) {
    case 'roles': return can(user, 'users.manage');
    case 'users': return can(user, 'users.manage') || row.id === user.id;
    case 'accounts': return can(user, 'accounts.view') || can(user, 'reports.financial') || can(user, 'reports.profit');
    case 'warehouses': return can(user, 'inventory.view') && inScope(user.warehouse_ids, row.id);
    case 'items':
    case 'categories':
    case 'item_units':
    case 'item_prices': return can(user, 'items.view');
    case 'stock_balances': return can(user, 'inventory.view') && inScope(user.warehouse_ids, row.warehouse_id);
    case 'parties': return can(user, 'parties.view');
    case 'cashboxes': return can(user, 'treasury.view') && inScope(user.cashbox_ids, row.id);
    case 'documents': return documentVisible(row, user);
    case 'document_lines': {
      if (!can(user, 'costs.view')) { delete row.cost; delete row.value; }
      return false;
    }
    case 'sync_conflicts': return row.created_by === user.id || can(user, 'conflicts.resolve');
    case 'instruments': return can(user, 'treasury.instruments');
    case 'cashier_shifts': return row.user_id === user.id || can(user, 'treasury.manage');
    case 'partners': return can(user, 'partners.view');
    case 'settings': return ['role_home_pages', 'company_name', 'print_logo'].includes(row.key) || can(user, 'settings.manage');
    case 'sales_reps': return can(user, 'sales.view') || can(user, 'parties.view');
    case 'price_lists': return can(user, 'items.view');
    case 'party_groups': return can(user, 'parties.view');
    case 'employees': return can(user, 'employees.view') || row.user_id === user.id;
    case 'attendance': return can(user, 'employees.view') || can(user, 'employees.attendance');
    default: return false;
  }
}

/**
 * Incremental pull keeps its global row-version cursor, but only serializes rows the
 * authenticated employee can see. Filtering after each bounded query is safe because
 * the cursor advances over every row in the window for all employees.
 */
export async function pull(db: Db, cursor: number, user: AuthUser) {
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
      const allowed = [];
      for (const row of rows) {
        if (table === 'document_lines') {
          const doc = await t.one(`select id, doc_type, warehouse_id, to_warehouse_id, cashbox_id, data from documents where id = $1`, [row.document_id]);
          if (doc && documentVisible(doc, user)) {
            if (!can(user, 'costs.view')) { delete row.cost; delete row.value; }
            allowed.push(row);
          }
        } else if (visible(table, row, user)) allowed.push(row);
      }
      if (allowed.length) changes[table] = allowed;
    }
    const epoch = (await t.one(`select value from settings where key = 'db_epoch'`))?.value ?? null;
    return { cursor: upto, more: upto < max, epoch, changes, server_time: new Date().toISOString() };
  });
}
