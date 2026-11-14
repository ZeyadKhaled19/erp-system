import { computeDocument, DOC_TYPES, toBaseQty, type DocInput, type MasterEntity } from '@erp/shared';
import { db } from './db';
import { enqueue, nextLocalNumber } from './sync';

const TABLE: Record<MasterEntity, 'items' | 'parties' | 'warehouses' | 'categories' | 'cashboxes' | 'accounts' | 'sales_reps' | 'price_lists' | 'partners' | 'party_groups' | 'scooter_brands' | 'employees' | 'attendance' | 'departments' | 'job_titles'> = {
  item: 'items',
  party: 'parties',
  warehouse: 'warehouses',
  category: 'categories',
  cashbox: 'cashboxes',
  account: 'accounts',
  sales_rep: 'sales_reps',
  price_list: 'price_lists',
  partner: 'partners',
  party_group: 'party_groups',
  scooter_brand: 'scooter_brands',
  employee: 'employees',
  attendance: 'attendance',
  department: 'departments',
  job_title: 'job_titles',
};
const LABEL: Record<MasterEntity, string> = {
  item: 'صنف', party: 'طرف', warehouse: 'مخزن', category: 'تصنيف', cashbox: 'خزينة', account: 'حساب', sales_rep: 'مندوب', price_list: 'قائمة أسعار', partner: 'شريك', party_group: 'نوع عميل', scooter_brand: 'ماركة سكوتر', employee: 'موظف', attendance: 'حضور', department: 'إدارة', job_title: 'وظيفة',
};

/** حفظ بيانات أساسية: يظهر فورًا على الجهاز ويُرفع عند الاتصال */
export async function saveMaster(entity: MasterEntity, id: string, data: Record<string, any>, existing?: Record<string, any> | null) {
  const baseVersion = existing ? (existing.version ?? 1) : null;
  return enqueue(
    { type: 'master.upsert', entity, id, base_version: baseVersion, data },
    {
      label: `${existing ? 'تعديل' : 'إضافة'} ${LABEL[entity]}: ${data.name ?? data.code ?? data.date ?? ''}`,
      entity,
      entity_id: id,
      apply: async () => {
        const { units, prices, ...rest } = data;
        await (db as any)[TABLE[entity]].put({
          ...(existing ?? {}),
          ...rest,
          id,
          version: (baseVersion ?? 0) + 1,
          balance: existing?.balance ?? 0,
          _sync: 'pending',
          _error: undefined,
        });
        if (entity === 'item' && Array.isArray(units)) {
          const keep = new Set(units.map((u: any) => u.id));
          const old = await db.item_units.where('item_id').equals(id).toArray();
          for (const o of old) if (!keep.has(o.id)) await db.item_units.update(o.id, { active: false });
          for (const u of units) await db.item_units.put({ ...u, item_id: id, active: u.active ?? true });
        }
        if (entity === 'item' && Array.isArray(prices)) {
          for (const p of prices) {
            const ex = await db.item_prices.where('[item_id+unit_name+price_list_id]').equals([id, p.unit_name, p.price_list_id]).first();
            if (p.price > 0) await db.item_prices.put({ id: ex?.id ?? crypto.randomUUID(), item_id: id, ...p });
            else if (ex) await db.item_prices.delete(ex.id);
          }
        }
      },
    },
  );
}

/** حفظ مستند (مسودة أو ترحيل) */
export async function saveDocument(doc: DocInput, action: 'draft' | 'post', existing?: Record<string, any> | null) {
  const info = DOC_TYPES[doc.doc_type];
  const baseVersion = existing ? (existing.version ?? 1) : null;
  if (!existing && !doc.local_number) doc.local_number = await nextLocalNumber();
  let totals = { gross: 0, discount: 0, tax: 0, total: 0, lines: [] as ReturnType<typeof computeDocument>['lines'] };
  if (info.priced || doc.doc_type === 'opening_stock') {
    totals = computeDocument(
      doc.lines.map((l) => ({ qty: l.qty, price: l.price, discount: info.priced ? l.discount : 0, tax_rate_bp: info.priced ? l.tax_rate_bp : 0 })),
      info.priced ? doc.discount : 0,
    );
  } else if (doc.doc_type === 'journal_voucher') {
    totals.total = doc.journal_lines.reduce((s, l) => s + l.debit, 0);
  } else if (!info.hasLines) totals.total = doc.amount;
  const chargesAdd = (doc.charges ?? []).filter((c) => c.mode === 'add').reduce((s, c) => s + c.amount, 0);
  totals.total += chargesAdd;
  const cashPaid = (doc.payments ?? []).reduce((s, p) => s + p.amount, 0);
  const chequePaid = (doc.instruments ?? []).filter((x) => x.kind === 'cheque').reduce((s, x) => s + x.amount, 0);
  const paid = info.priced ? (info.noPosting ? 0 : cashPaid + chequePaid) : totals.total;

  return enqueue(
    { type: 'doc.save', action, base_version: baseVersion, doc },
    {
      label: `${action === 'post' ? 'ترحيل' : 'حفظ مسودة'} ${info.label} ${existing?.number ?? doc.local_number ?? ''}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        const { lines, journal_lines, payments, instruments, from_quotation_id, charges, ...header } = doc;
        await db.documents.put({
          ...(existing ?? {}),
          ...header,
          gross: totals.gross,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          paid,
          data: { journal_lines, payments, instruments, from_quotation_id, charges },
          charges_total: chargesAdd,
          status: action === 'post' ? 'posted' : 'draft',
          number: existing?.number ?? null,
          version: (baseVersion ?? 0) + 1,
          created_at: existing?.created_at ?? new Date().toISOString(),
          _sync: 'pending',
          _error: undefined,
        });
        await db.document_lines.where('document_id').equals(doc.id).delete();
        await db.document_lines.bulkPut(
          lines.map((l, i) => ({
            ...l,
            document_id: doc.id,
            line_no: i + 1,
            base_qty: toBaseQty(l.qty, l.unit_factor),
            tax: totals.lines[i]?.tax ?? 0,
            total: totals.lines[i]?.total ?? 0,
            discount: totals.lines[i]?.line_discount ?? 0,
            doc_discount: totals.lines[i]?.doc_discount ?? 0,
          })),
        );
      },
    },
  );
}

export async function postDocument(doc: Record<string, any>) {
  return enqueue(
    { type: 'doc.post', id: doc.id, base_version: doc._sync ? null : (doc.version ?? null) },
    {
      label: `ترحيل ${DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES].label} ${doc.number ?? doc.local_number}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        await db.documents.update(doc.id, { status: 'posted', _sync: 'pending' });
      },
    },
  );
}

export async function cancelDocument(doc: Record<string, any>, reason: string) {
  return enqueue(
    { type: 'doc.cancel', id: doc.id, reason },
    {
      label: `إلغاء ${DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES].label} ${doc.number ?? doc.local_number}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        await db.documents.update(doc.id, { status: 'cancelled', cancel_reason: reason, _sync: 'pending' });
      },
    },
  );
}

export async function resolveConflict(conflict: Record<string, any>, resolution: 'keep_server' | 'apply_client' | 'post_anyway' | 'discard', note?: string) {
  return enqueue(
    { type: 'conflict.resolve', id: conflict.id, resolution, note: note ?? null },
    {
      label: `حل تعارض: ${conflict.message}`,
      entity: 'conflict',
      entity_id: conflict.id,
      apply: async () => {
        await db.sync_conflicts.update(conflict.id, { status: 'resolving' });
      },
    },
  );
}

/**
 * الرصيد المتاح كما يراه هذا الجهاز: الرصيد المركزي آخر مزامنة
 * ناقص الكميات المنصرفة في مستندات محلية لم تُقبل بعد.
 */
export async function localAvailable(itemId: string, warehouseId: string, excludeDocId?: string): Promise<number> {
  const bal = await db.stock_balances.get([itemId, warehouseId]);
  let qty = bal?.qty ?? 0;
  const pendingDocs = await db.documents.where('_sync').equals('pending').toArray();
  for (const d of pendingDocs) {
    if (d.id === excludeDocId || d.status !== 'posted') continue;
    const info = DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES];
    if (!info?.stock) continue;
    const lines = await db.document_lines.where('document_id').equals(d.id).filter((l) => l.item_id === itemId).toArray();
    const q = lines.reduce((s, l) => s + (l.base_qty ?? 0), 0);
    if (info.stock === 'out' && d.warehouse_id === warehouseId) qty -= q;
    if (info.stock === 'in' && d.warehouse_id === warehouseId) qty += q;
    if (info.stock === 'transfer') {
      if (d.warehouse_id === warehouseId) qty -= q;
      if (d.to_warehouse_id === warehouseId) qty += q;
    }
  }
  return qty;
}

export async function closeCreditInvoice(doc: Record<string, any>, closed: boolean) {
  return enqueue(
    { type: 'doc.close', id: doc.id, closed },
    {
      label: `${closed ? 'إغلاق' : 'إعادة فتح'} متابعة ${doc.number}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        await db.documents.update(doc.id, { closed, _sync: 'pending' });
      },
    },
  );
}

export async function settleInstrument(x: Record<string, any>, action: 'collect' | 'bounce' | 'close', o: { cashbox_id?: string | null; date: string; note?: string }) {
  const label = x.kind === 'cheque' ? `شيك ${x.cheque_no ?? ''}` : 'قسط';
  const verb = action === 'collect' ? (x.direction === 'in' ? 'تحصيل' : 'سداد') : action === 'bounce' ? 'ارتداد' : 'إغلاق';
  return enqueue(
    { type: 'instrument.settle', id: x.id, action, cashbox_id: o.cashbox_id ?? null, date: o.date, note: o.note ?? null },
    {
      label: `${verb} ${label}`,
      entity: 'instrument',
      entity_id: x.id,
      apply: async () => {
        await db.instruments.update(x.id, { status: action === 'collect' ? 'collected' : action === 'bounce' ? 'bounced' : 'closed', _sync: 'pending' });
      },
    },
  );
}

export async function openShift(id: string, cashbox_id: string, opening_float: number, userId: string) {
  return enqueue(
    { type: 'shift.open', id, cashbox_id, opening_float },
    {
      label: 'فتح وردية',
      entity: 'shift',
      entity_id: id,
      apply: async () => {
        await db.cashier_shifts.put({ id, user_id: userId, cashbox_id, opening_float, status: 'open', opened_at: new Date().toISOString(), _sync: 'pending' });
      },
    },
  );
}

export async function closeShift(id: string, counted_cash: number, date: string, notes?: string) {
  return enqueue(
    { type: 'shift.close', id, counted_cash, date, notes: notes ?? null },
    {
      label: 'إقفال وردية',
      entity: 'shift',
      entity_id: id,
      apply: async () => {
        await db.cashier_shifts.update(id, { status: 'closed', counted_cash, closed_at: new Date().toISOString(), _sync: 'pending' });
      },
    },
  );
}

/** السعر حسب قائمة الأسعار (محليًا) */
export async function priceFor(item: Record<string, any>, unit: { name: string; factor: number; sale_price?: number; wholesale_price?: number }, priceListId: string | null) {
  if (priceListId) {
    const p = await db.item_prices.where('[item_id+unit_name+price_list_id]').equals([item.id, unit.name, priceListId]).first();
    if (p) return p.price as number;
  }
  if (priceListId === 'pl-wholesale' && unit.wholesale_price) return unit.wholesale_price;
  if (unit.name !== item.base_unit && unit.sale_price) return unit.sale_price;
  if (unit.name === item.base_unit) return item.sale_price;
  return Math.round((item.sale_price * unit.factor) / 1000);
}

/** تسجيل تسليم (جزئي أو كامل) لفاتورة بيع مؤجلة التسليم */
export async function recordDelivery(doc: Record<string, any>, date: string, lines: { line_id: string; qty: number; serials: string[] }[], notes?: string) {
  const id = crypto.randomUUID();
  return enqueue(
    { type: 'delivery.record', id, document_id: doc.id, date, notes: notes ?? null, lines },
    {
      label: `تسليم من فاتورة ${doc.number ?? doc.local_number}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        for (const l of lines) {
          const row = await db.document_lines.get(l.line_id);
          if (row) await db.document_lines.update(l.line_id, { delivered_qty: (row.delivered_qty ?? 0) + l.qty });
        }
        await db.documents.update(doc.id, { _sync: 'pending' });
      },
    },
  );
}

export async function setDocMeta(doc: Record<string, any>, order_status: string | null, shipping_company: string | null) {
  return enqueue(
    { type: 'doc.meta', id: doc.id, order_status, shipping_company },
    {
      label: `تحديث حالة الطلب ${doc.number ?? doc.local_number}`,
      entity: 'document',
      entity_id: doc.id,
      apply: async () => {
        await db.documents.update(doc.id, { order_status, shipping_company, _sync: 'pending' });
      },
    },
  );
}
