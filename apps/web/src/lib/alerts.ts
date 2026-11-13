import { hasPermission, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useSession, useSyncCounts } from './hooks';

export interface WorkCounts {
  /** فواتير بيع آجلة عدّى ميعاد سدادها */
  overdue: number;
  /** أصناف وصلت لحد الطلب أو أقل */
  reorder: number;
  /** عدد العملاء اللي عليهم فلوس، وإجمالي المستحق */
  customers: number;
  customersAmount: number;
  /** عدد الموردين اللي لهم فلوس، وإجمالي المستحق */
  suppliers: number;
  suppliersAmount: number;
  /** شيكات وأقساط مستحقة خلال أسبوع */
  dueSoon: number;
  /** فواتير بانتظار التسليم */
  pendingDelivery: number;
  /** مستندات بانتظار المراجعة + مشاكل المزامنة */
  review: number;
}

const EMPTY: WorkCounts = { overdue: 0, reorder: 0, customers: 0, customersAmount: 0, suppliers: 0, suppliersAmount: 0, dueSoon: 0, pendingDelivery: 0, review: 0 };

/**
 * أرقام «مهامي السريعة» والإشعارات من بيانات الجهاز، وكل رقم لا يُحسب إلا لمن يملك صلاحية مشاهدته.
 */
export function useWorkCounts(): WorkCounts {
  const { session } = useSession();
  const perms = session.user.permissions;
  const sync = useSyncCounts();
  const data = useLiveQuery(async () => {
    const can = (p: string) => hasPermission(perms, p);
    const today = todayISO();
    const out = { ...EMPTY };
    if (can('sales.view')) {
      const sales = await db.documents.where('doc_type').equals('sale_invoice').toArray();
      out.overdue = sales.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid && d.due_date && d.due_date < today).length;
      out.pendingDelivery = sales.filter((d) => d.status === 'posted' && d.deliver_later).length;
    }
    if (can('inventory.view')) {
      const qty = new Map<string, number>();
      (await db.stock_balances.toArray()).forEach((b) => qty.set(b.item_id, (qty.get(b.item_id) ?? 0) + b.qty));
      out.reorder = (await db.items.toArray()).filter((i) => i.active && i.reorder_level > 0 && (qty.get(i.id) ?? 0) <= i.reorder_level).length;
    }
    if (can('parties.view')) {
      const parties = await db.parties.toArray();
      const owe = parties.filter((p) => p.kind === 'customer' && (p.balance ?? 0) > 0.005);
      const due = parties.filter((p) => p.kind === 'supplier' && (p.balance ?? 0) > 0.005);
      out.customers = owe.length;
      out.customersAmount = owe.reduce((s, p) => s + (p.balance ?? 0), 0);
      out.suppliers = due.length;
      out.suppliersAmount = due.reduce((s, p) => s + (p.balance ?? 0), 0);
    }
    if (can('treasury.view')) {
      const week = new Date();
      week.setDate(week.getDate() + 7);
      const limit = todayISO(week);
      out.dueSoon = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= limit).length;
    }
    out.review = await db.documents.where('status').equals('pending_review').count();
    return out;
  }, [perms.join(',')]);
  const d = data ?? EMPTY;
  return { ...d, review: d.review + sync.rejected + sync.conflicts };
}
