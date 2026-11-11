import { formatQty } from '@erp/shared';
import type { Db } from '../db';
import { AppError } from '../errors';

/**
 * تتبع السيريال (صارم) ودفعات الصلاحية:
 * - السيريال يدخل المخزن بمستند وارد (شراء/أول مدة/مرتجع بيع/جرد زيادة) ولا يُصرف إلا إذا كان بالمخزن نفسه،
 *   ولا يُباع مرتين، وعدد الأرقام = الكمية بالوحدة الأساسية.
 * - الصلاحية: كل وارد يُسجل كدفعة (مخزن + تاريخ انتهاء)، والصرف يتم من الأقرب انتهاءً (FEFO).
 */

const addDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function serialList(item: any, line: any, qty: number): string[] {
  const list: string[] = (line.serials ?? []).map((s: string) => String(s).trim()).filter(Boolean);
  if (qty % 1000 !== 0) throw new AppError(`الصنف «${item.name}» متتبع بالسيريال: الكمية يجب أن تكون عددًا صحيحًا`);
  const need = qty / 1000;
  if (list.length !== need) throw new AppError(`الصنف «${item.name}»: أدخل ${need} رقم سيريال (المُدخل ${list.length})`);
  if (new Set(list).size !== list.length) throw new AppError(`الصنف «${item.name}»: يوجد رقم سيريال مكرر في نفس السطر`);
  return list;
}

interface Ctx {
  date: string;
  doc: any;
  line: any;
  item: any;
  warehouse_id: string;
  qty: number;
}

export async function trackIn(t: Db, c: Ctx, opts: { serialsOverride?: string[] } = {}) {
  const { item, line, doc } = c;
  if (item.track_serial) {
    const list = opts.serialsOverride ?? serialList(item, line, c.qty);
    for (const s of list) {
      const ex = await t.one(`select * from serials where item_id = $1 and serial = $2 for update`, [item.id, s]);
      if (ex) {
        if (ex.status === 'in_stock') throw new AppError(`السيريال ${s} للصنف «${item.name}» موجود بالفعل في المخزن`);
        if (doc.doc_type === 'sale_return' && ex.status !== 'sold') throw new AppError(`السيريال ${s} لم يُبع حتى يُرتجع`);
        await t.query(`update serials set status = 'in_stock', warehouse_id = $2, in_doc_id = $3 where id = $1`, [ex.id, c.warehouse_id, doc.id]);
        await t.query(`insert into serial_moves (serial_id, document_id, line_id, direction, warehouse_id) values ($1,$2,$3,'in',$4)`, [ex.id, doc.id, line.id, c.warehouse_id]);
      } else {
        if (doc.doc_type === 'sale_return') throw new AppError(`السيريال ${s} غير مسجل في النظام فلا يمكن إرجاعه`);
        const id = crypto.randomUUID();
        await t.query(`insert into serials (id, item_id, serial, warehouse_id, status, in_doc_id) values ($1,$2,$3,$4,'in_stock',$5)`, [id, item.id, s, c.warehouse_id, doc.id]);
        await t.query(`insert into serial_moves (serial_id, document_id, line_id, direction, warehouse_id) values ($1,$2,$3,'in',$4)`, [id, doc.id, line.id, c.warehouse_id]);
      }
    }
  }
  if (item.track_expiry) {
    const expiry = line.expiry || (item.expiry_default_days ? addDays(c.date, item.expiry_default_days) : null);
    if (!expiry) throw new AppError(`أدخل تاريخ الصلاحية للصنف «${item.name}»`);
    await addToLot(t, item.id, c.warehouse_id, expiry, c.qty, doc.id, line.id);
    if (!line.expiry) await t.query(`update document_lines set expiry = $2 where id = $1`, [line.id, expiry]);
  }
}

async function addToLot(t: Db, itemId: string, whId: string, expiry: string, qty: number, docId: string, lineId: string, reversal = false) {
  await t.query(
    `insert into stock_lots (id, item_id, warehouse_id, expiry, qty) values ($1,$2,$3,$4,0) on conflict (item_id, warehouse_id, expiry) do nothing`,
    [crypto.randomUUID(), itemId, whId, expiry],
  );
  const lot = await t.one(`select id from stock_lots where item_id = $1 and warehouse_id = $2 and expiry = $3 for update`, [itemId, whId, expiry]);
  await t.query(`update stock_lots set qty = qty + $2 where id = $1`, [lot.id, qty]);
  await t.query(`insert into lot_moves (lot_id, document_id, line_id, qty, reversal) values ($1,$2,$3,$4,$5)`, [lot.id, docId, lineId, qty, reversal]);
}

/** الصرف: يُرجع دفعات الصلاحية التي صُرفت (لاستخدامها في التحويل) */
export async function trackOut(t: Db, c: Ctx, mode: 'sell' | 'return_supplier' | 'transfer' | 'adjust'): Promise<{ serials: string[]; lots: { expiry: string; qty: number }[] }> {
  const { item, line, doc } = c;
  const out = { serials: [] as string[], lots: [] as { expiry: string; qty: number }[] };
  if (item.track_serial) {
    const list = serialList(item, line, c.qty);
    for (const s of list) {
      const ex = await t.one(`select * from serials where item_id = $1 and serial = $2 for update`, [item.id, s]);
      if (!ex) throw new AppError(`السيريال ${s} غير موجود للصنف «${item.name}»`);
      if (ex.status !== 'in_stock') throw new AppError(`السيريال ${s} للصنف «${item.name}» ${ex.status === 'sold' ? 'مُباع من قبل' : 'غير موجود بالمخزن'}`);
      if (ex.warehouse_id !== c.warehouse_id) throw new AppError(`السيريال ${s} موجود في مخزن آخر`);
      const status = mode === 'sell' ? 'sold' : mode === 'return_supplier' || mode === 'adjust' ? 'returned_to_supplier' : 'in_stock';
      await t.query(`update serials set status = $2, out_doc_id = $3 where id = $1`, [ex.id, status, mode === 'transfer' ? ex.out_doc_id : doc.id]);
      await t.query(`insert into serial_moves (serial_id, document_id, line_id, direction, warehouse_id) values ($1,$2,$3,'out',$4)`, [ex.id, doc.id, line.id, c.warehouse_id]);
      out.serials.push(s);
    }
  }
  if (item.track_expiry) {
    let remaining = c.qty;
    const lots = await t.query(`select * from stock_lots where item_id = $1 and warehouse_id = $2 and qty > 0 order by expiry for update`, [item.id, c.warehouse_id]);
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.qty, remaining);
      await t.query(`update stock_lots set qty = qty - $2 where id = $1`, [lot.id, take]);
      await t.query(`insert into lot_moves (lot_id, document_id, line_id, qty) values ($1,$2,$3,$4)`, [lot.id, doc.id, line.id, -take]);
      out.lots.push({ expiry: lot.expiry, qty: take });
      remaining -= take;
    }
    // الكمية التي لا تغطيها دفعات (رصيد قديم قبل تفعيل الصلاحية) تُصرف بدون دفعة
  }
  return out;
}

/** التحويل: السيريال يغيّر مخزنه، والدفعات تنتقل بنفس تواريخها */
export async function trackTransfer(t: Db, c: Ctx, toWarehouse: string) {
  const res = await trackOut(t, c, 'transfer');
  for (const s of res.serials) {
    const ex = await t.one(`select id from serials where item_id = $1 and serial = $2`, [c.item.id, s]);
    await t.query(`update serials set warehouse_id = $2 where id = $1`, [ex.id, toWarehouse]);
    await t.query(`insert into serial_moves (serial_id, document_id, line_id, direction, warehouse_id) values ($1,$2,$3,'in',$4)`, [ex.id, c.doc.id, c.line.id, toWarehouse]);
  }
  for (const l of res.lots) await addToLot(t, c.item.id, toWarehouse, l.expiry, l.qty, c.doc.id, c.line.id);
}

export async function reverseTracking(t: Db, docId: string) {
  const sm = await t.query(`select m.*, s.status, s.warehouse_id as cur_wh, s.serial from serial_moves m join serials s on s.id = m.serial_id where m.document_id = $1 and not m.reversal order by m.id desc`, [docId]);
  for (const m of sm) {
    const cur = await t.one(`select * from serials where id = $1 for update`, [m.serial_id]);
    if (m.direction === 'in') {
      if (cur.status !== 'in_stock' || cur.warehouse_id !== m.warehouse_id) throw new AppError(`لا يمكن الإلغاء: السيريال ${cur.serial} صُرف بعد هذا المستند`, 'state');
      const prevOut = await t.one(`select 1 from serial_moves where serial_id = $1 and direction = 'out' and document_id <> $2 and not reversal limit 1`, [m.serial_id, docId]);
      await t.query(`update serials set status = $2 where id = $1`, [m.serial_id, prevOut ? 'sold' : 'returned_to_supplier']);
    } else {
      await t.query(`update serials set status = 'in_stock', warehouse_id = $2 where id = $1`, [m.serial_id, m.warehouse_id]);
    }
    await t.query(`insert into serial_moves (serial_id, document_id, line_id, direction, warehouse_id, reversal) values ($1,$2,$3,$4,$5,true)`, [
      m.serial_id, docId, m.line_id, m.direction === 'in' ? 'out' : 'in', m.warehouse_id,
    ]);
  }
  const lm = await t.query(`select * from lot_moves where document_id = $1 and not reversal order by id desc`, [docId]);
  for (const m of lm) {
    const lot = await t.one(`select * from stock_lots where id = $1 for update`, [m.lot_id]);
    if (m.qty > 0 && lot.qty < m.qty) throw new AppError(`لا يمكن الإلغاء: كمية دفعة الصلاحية ${lot.expiry} صُرفت (المتبقي ${formatQty(lot.qty)})`, 'state');
    await t.query(`update stock_lots set qty = qty - $2 where id = $1`, [m.lot_id, m.qty]);
    await t.query(`insert into lot_moves (lot_id, document_id, line_id, qty, reversal) values ($1,$2,$3,$4,true)`, [m.lot_id, docId, m.line_id, -m.qty]);
  }
}
