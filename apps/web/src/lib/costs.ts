import { formatMoney } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

export interface CostInfo {
  /** آخر سعر شراء للوحدة الأساسية */
  last?: number;
  lastDate?: string;
  /** متوسط التكلفة للوحدة الأساسية في المخزن */
  avg?: number;
}

/**
 * أسعار الشراء من بيانات الجهاز: آخر فاتورة شراء مرحّلة لكل صنف، ومتوسط التكلفة من رصيد المخزن.
 * عرض فقط، ولا يُستدعى إلا لمن لديه صلاحية رؤية التكلفة.
 */
export function useCostMap(warehouseId: string | undefined, enabled: boolean): Map<string, CostInfo> {
  return (
    useLiveQuery(async () => {
      const m = new Map<string, CostInfo>();
      if (!enabled) return m;
      const purchases = (await db.documents.where('doc_type').equals('purchase_invoice').toArray()).filter((d) => d.status === 'posted');
      const dateOf = new Map(purchases.map((d) => [d.id, `${d.date}|${d.created_at ?? ''}`]));
      if (purchases.length) {
        const lines = await db.document_lines.where('document_id').anyOf([...dateOf.keys()]).toArray();
        for (const l of lines) {
          const key = dateOf.get(l.document_id)!;
          const cur = m.get(l.item_id);
          if (!cur?.lastDate || key > cur.lastDate) {
            const perBase = l.unit_factor ? Math.round((l.price * 1000) / l.unit_factor) : l.price;
            m.set(l.item_id, { ...cur, last: perBase, lastDate: key });
          }
        }
      }
      if (warehouseId) {
        for (const b of await db.stock_balances.where('warehouse_id').equals(warehouseId).toArray()) {
          if (b.qty > 0 && b.value != null) {
            const cur = m.get(b.item_id) ?? {};
            m.set(b.item_id, { ...cur, avg: Math.round((b.value * 1000) / b.qty) });
          }
        }
      }
      for (const v of m.values()) if (v.lastDate) v.lastDate = v.lastDate.split('|')[0];
      return m;
    }, [warehouseId, enabled]) ?? new Map()
  );
}

/** نص التلميح: «آخر سعر شراء … · متوسط التكلفة …» (للوحدة الأساسية) */
export function costTip(c: CostInfo | undefined, unitLabel?: string): string {
  if (!c || (c.last == null && c.avg == null)) return 'لا يوجد سعر شراء مسجل لهذا الصنف';
  const parts: string[] = [];
  if (c.last != null) parts.push(`آخر سعر شراء: ${formatMoney(c.last)}${c.lastDate ? ` (${c.lastDate})` : ''}`);
  if (c.avg != null) parts.push(`متوسط التكلفة: ${formatMoney(c.avg)}`);
  return parts.join('\n') + (unitLabel ? `\nلكل ${unitLabel}` : '');
}
