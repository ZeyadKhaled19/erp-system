import { formatQty, mulDiv, QTY_SCALE } from '@erp/shared';
import type { Db } from '../db';
import { AppError, ReviewError } from '../errors';

/**
 * المخزون بطريقة المتوسط المرجح لكل صنف في كل مخزن.
 * كل حركة تُسجل في stock_moves (كمية وقيمة موقّعتين) ويُحدّث الرصيد في نفس المعاملة.
 */

async function lockBalance(t: Db, itemId: string, warehouseId: string) {
  await t.query(`insert into stock_balances (item_id, warehouse_id) values ($1, $2) on conflict do nothing`, [itemId, warehouseId]);
  return (await t.one<{ qty: number; value: number }>(
    `select qty, value from stock_balances where item_id = $1 and warehouse_id = $2 for update`,
    [itemId, warehouseId],
  ))!;
}

async function itemRow(t: Db, itemId: string) {
  const it = await t.one(`select id, name, avg_cost, active from items where id = $1`, [itemId]);
  if (!it) throw new AppError('صنف غير موجود');
  return it;
}

async function refreshItemCost(t: Db, itemId: string, lastUnitCost?: number) {
  const s = await t.one<{ q: number; v: number }>(
    `select coalesce(sum(qty), 0)::bigint as q, coalesce(sum(value), 0)::bigint as v from stock_balances where item_id = $1 and qty > 0`,
    [itemId],
  );
  const avg = s && s.q > 0 ? mulDiv(s.v, QTY_SCALE, s.q) : undefined;
  await t.query(
    `update items set avg_cost = coalesce($2, avg_cost), last_cost = coalesce($3, last_cost) where id = $1`,
    [itemId, avg ?? null, lastUnitCost ?? null],
  );
}

interface MoveArgs {
  date: string;
  item_id: string;
  warehouse_id: string;
  /** كمية بالوحدة الأساسية (milli) موجبة */
  qty: number;
  document_id: string;
  line_id?: string | null;
  reversal?: boolean;
}

export async function stockIn(t: Db, a: MoveArgs & { value: number; setLastCost?: boolean }) {
  if (a.qty <= 0) throw new AppError('الكمية يجب أن تكون أكبر من صفر');
  await itemRow(t, a.item_id);
  const bal = await lockBalance(t, a.item_id, a.warehouse_id);
  const newQty = bal.qty + a.qty;
  // إذا كان الرصيد سالبًا (بيع بالسالب سابقًا) نصحح القيمة بحيث لا تبقى قيمة بلا كمية
  const newValue = newQty === 0 ? 0 : bal.value + a.value;
  await t.query(`update stock_balances set qty = $3, value = $4 where item_id = $1 and warehouse_id = $2`, [a.item_id, a.warehouse_id, newQty, newValue]);
  await t.query(
    `insert into stock_moves (date, item_id, warehouse_id, qty, value, balance_qty, document_id, line_id, reversal) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [a.date, a.item_id, a.warehouse_id, a.qty, a.value, newQty, a.document_id, a.line_id ?? null, !!a.reversal],
  );
  await refreshItemCost(t, a.item_id, a.setLastCost ? mulDiv(a.value, QTY_SCALE, a.qty) : undefined);
}

/** يُرجع قيمة (تكلفة) الكمية المنصرفة */
export async function stockOut(t: Db, a: MoveArgs & { allowNegative: boolean; explicitValue?: number }): Promise<number> {
  if (a.qty <= 0) throw new AppError('الكمية يجب أن تكون أكبر من صفر');
  const item = await itemRow(t, a.item_id);
  const bal = await lockBalance(t, a.item_id, a.warehouse_id);
  if (bal.qty < a.qty && !a.allowNegative) {
    throw new ReviewError('stock_shortage', `الرصيد غير كافٍ للصنف «${item.name}»: المتاح ${formatQty(bal.qty)} والمطلوب ${formatQty(a.qty)}`, {
      item_id: a.item_id,
      warehouse_id: a.warehouse_id,
      available: bal.qty,
      requested: a.qty,
    });
  }
  let value: number;
  if (a.explicitValue !== undefined) value = a.explicitValue;
  else if (bal.qty <= 0) value = mulDiv(a.qty, item.avg_cost, QTY_SCALE);
  else if (a.qty >= bal.qty) value = bal.value + mulDiv(a.qty - bal.qty, item.avg_cost, QTY_SCALE);
  else value = mulDiv(bal.value, a.qty, bal.qty);

  const newQty = bal.qty - a.qty;
  const newValue = newQty === 0 ? 0 : bal.value - value;
  if (newQty === 0) value = bal.value; // لا تبقى قيمة بلا كمية
  await t.query(`update stock_balances set qty = $3, value = $4 where item_id = $1 and warehouse_id = $2`, [a.item_id, a.warehouse_id, newQty, newValue]);
  await t.query(
    `insert into stock_moves (date, item_id, warehouse_id, qty, value, balance_qty, document_id, line_id, reversal) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [a.date, a.item_id, a.warehouse_id, -a.qty, -value, newQty, a.document_id, a.line_id ?? null, !!a.reversal],
  );
  return value;
}

export async function currentQty(t: Db, itemId: string, warehouseId: string) {
  const r = await t.one<{ qty: number }>(`select qty from stock_balances where item_id = $1 and warehouse_id = $2`, [itemId, warehouseId]);
  return r?.qty ?? 0;
}

/** عكس حركات مخزون مستند عند إلغائه */
export async function reverseStockMoves(t: Db, documentId: string, date: string) {
  const moves = await t.query(`select * from stock_moves where document_id = $1 and reversal = false order by id desc`, [documentId]);
  for (const m of moves) {
    if (m.qty < 0) {
      await stockIn(t, { date, item_id: m.item_id, warehouse_id: m.warehouse_id, qty: -m.qty, value: -m.value, document_id: documentId, line_id: m.line_id, reversal: true });
    } else {
      try {
        await stockOut(t, {
          date,
          item_id: m.item_id,
          warehouse_id: m.warehouse_id,
          qty: m.qty,
          explicitValue: m.value,
          allowNegative: false,
          document_id: documentId,
          line_id: m.line_id,
          reversal: true,
        });
      } catch (e) {
        if (e instanceof ReviewError) throw new AppError('لا يمكن الإلغاء: ' + e.message + ' (تم صرف جزء من الكمية بعد هذا المستند)', 'state');
        throw e;
      }
    }
  }
}
