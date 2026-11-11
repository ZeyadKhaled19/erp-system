import { computeDocument, DOC_TYPES, hasPermission, toBaseQty, type DocInput, type DocType } from '@erp/shared';
import type { AuthUser } from '../auth';
import type { Db } from '../db';
import { AppError, ReviewError } from '../errors';
import { getSettings, reverseDocumentJournals, sysAccount, writeJournal, type JLine } from './ledger';
import { currentQty, reverseStockMoves, stockIn, stockOut } from './stock';

export interface Ctx {
  user: AuthUser;
  deviceId: string;
  opId?: string;
}

export const CASH_CUSTOMER_ID = 'party-cash-customer';

async function nextNumber(t: Db, docType: DocType): Promise<string> {
  const info = DOC_TYPES[docType];
  const r = await t.one<{ next_no: number }>(
    `insert into doc_sequences (key, next_no) values ($1, 2) on conflict (key) do update set next_no = doc_sequences.next_no + 1 returning next_no - 1 as next_no`,
    [docType],
  );
  return `${info.prefix}-${String(r!.next_no).padStart(5, '0')}`;
}

async function mustGet(t: Db, table: string, id: string | null | undefined, label: string) {
  if (!id) throw new AppError(`${label} مطلوب`);
  const r = await t.one(`select * from ${table} where id = $1`, [id]);
  if (!r) throw new AppError(`${label} غير موجود (ربما لم يُزامن بعد)`);
  if (r.active === false) throw new AppError(`${label} «${r.name}» موقوف`);
  return r;
}

/**
 * يتحقق من المستند ويحسبه ويحفظه (كمسودة) — دون أي أثر محاسبي أو مخزني.
 */
export async function saveDocument(t: Db, ctx: Ctx, input: DocInput, existing?: any) {
  const info = DOC_TYPES[input.doc_type];
  if (!info) throw new AppError('نوع مستند غير معروف');
  const perms = ctx.user.permissions;

  // ---- التحقق من الحقول حسب النوع
  if (info.partyKind) {
    if (input.party_id) {
      const p = await mustGet(t, 'parties', input.party_id, 'الطرف');
      if (info.partyKind !== 'any' && p.kind !== info.partyKind) {
        throw new AppError(info.partyKind === 'customer' ? 'يجب اختيار عميل' : 'يجب اختيار مورد');
      }
    } else if (info.partyKind === 'supplier' || input.doc_type === 'party_opening') {
      throw new AppError('اختر الطرف');
    } else if (input.doc_type === 'sale_invoice' || input.doc_type === 'sale_return') {
      input.party_id = CASH_CUSTOMER_ID;
    }
  }
  if (info.stock) await mustGet(t, 'warehouses', input.warehouse_id, 'المخزن');
  if (info.stock === 'transfer') {
    await mustGet(t, 'warehouses', input.to_warehouse_id, 'المخزن المحوّل إليه');
    if (input.to_warehouse_id === input.warehouse_id) throw new AppError('لا يمكن التحويل لنفس المخزن');
  }
  if (info.hasLines && !input.lines.length) throw new AppError('أضف صنفًا واحدًا على الأقل');

  // ---- الأصناف
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    const item = await mustGet(t, 'items', l.item_id, 'الصنف');
    let factor = 1000;
    if (l.unit_name !== item.base_unit) {
      const u = await t.one(`select * from item_units where item_id = $1 and name = $2 and active`, [l.item_id, l.unit_name]);
      if (!u) throw new AppError(`الوحدة «${l.unit_name}» غير معرفة للصنف «${item.name}»`);
      factor = u.factor;
      if (info.priced && input.doc_type.startsWith('sale') && !hasPermission(perms, 'sales.price_change')) {
        const listPrice = (await partyPriceList(t, input.party_id)) === 'wholesale' ? u.wholesale_price || u.sale_price : u.sale_price;
        if (l.price !== listPrice) throw new AppError(`ليس لديك صلاحية تغيير سعر «${item.name}»`, 'forbidden');
      }
    } else if (info.priced && input.doc_type.startsWith('sale') && !hasPermission(perms, 'sales.price_change')) {
      const listPrice = (await partyPriceList(t, input.party_id)) === 'wholesale' ? item.wholesale_price || item.sale_price : item.sale_price;
      if (l.price !== listPrice) throw new AppError(`ليس لديك صلاحية تغيير سعر «${item.name}»`, 'forbidden');
    }
    if (l.unit_factor !== factor) throw new AppError(`معامل تحويل الوحدة للصنف «${item.name}» تغير؛ أعد اختيار الوحدة`);
    if (info.stock === 'adjust') {
      if (l.qty < 0) throw new AppError('الكمية الفعلية لا تكون سالبة');
    } else if (l.qty <= 0) throw new AppError(`كمية الصنف «${item.name}» يجب أن تكون أكبر من صفر`);
    lines.push({ ...l, line_no: i + 1, base_qty: toBaseQty(l.qty, factor), item });
  }

  if (input.doc_type.startsWith('sale') && !hasPermission(perms, 'sales.discount')) {
    if (input.discount > 0 || input.lines.some((l) => l.discount > 0)) throw new AppError('ليس لديك صلاحية منح خصم', 'forbidden');
  }

  // ---- الحساب
  let gross = 0, discount = 0, tax = 0, total = 0;
  let computed: ReturnType<typeof computeDocument>['lines'] = [];
  if (info.priced || input.doc_type === 'opening_stock') {
    const r = computeDocument(
      lines.map((l) => ({ qty: l.qty, price: l.price, discount: info.priced ? l.discount : 0, tax_rate_bp: info.priced ? l.tax_rate_bp : 0 })),
      info.priced ? input.discount : 0,
    );
    ({ gross, discount, tax, total } = r);
    computed = r.lines;
  } else if (!info.hasLines && input.doc_type !== 'journal_voucher') {
    if (input.amount <= 0) throw new AppError('المبلغ يجب أن يكون أكبر من صفر');
    total = input.amount;
  }

  let paid = input.paid;
  if (info.priced) {
    if (input.payment_type === 'cash' || input.party_id === CASH_CUSTOMER_ID) paid = total;
    if (paid > total) throw new AppError('المدفوع أكبر من الإجمالي');
    if (paid > 0 && !input.cashbox_id) throw new AppError('اختر الخزينة');
  }
  if (['receipt', 'payment', 'expense', 'income'].includes(input.doc_type)) {
    await mustGet(t, 'cashboxes', input.cashbox_id, 'الخزينة');
    if (!input.party_id && !input.account_id) throw new AppError('اختر الطرف أو الحساب');
    if (input.account_id) {
      const acc = await mustGet(t, 'accounts', input.account_id, 'الحساب');
      if (acc.is_group) throw new AppError('اختر حسابًا فرعيًا وليس رئيسيًا');
      if (input.doc_type === 'expense' && acc.type !== 'expense') throw new AppError('اختر حساب مصروف');
      if (input.doc_type === 'income' && acc.type !== 'revenue') throw new AppError('اختر حساب إيراد');
    }
    paid = total;
  }
  if (paid > 0 && input.cashbox_id) await mustGet(t, 'cashboxes', input.cashbox_id, 'الخزينة');

  if (input.doc_type === 'journal_voucher') {
    const jl = input.journal_lines;
    if (jl.length < 2) throw new AppError('القيد يحتاج سطرين على الأقل');
    const dr = jl.reduce((s, l) => s + l.debit, 0);
    const cr = jl.reduce((s, l) => s + l.credit, 0);
    if (dr !== cr) throw new AppError('القيد غير متوازن: إجمالي المدين لا يساوي إجمالي الدائن');
    if (dr === 0) throw new AppError('القيد بدون مبالغ');
    for (const l of jl) {
      if (l.debit > 0 && l.credit > 0) throw new AppError('السطر الواحد لا يكون مدينًا ودائنًا معًا');
      const acc = await mustGet(t, 'accounts', l.account_id, 'الحساب');
      if (acc.is_group) throw new AppError(`الحساب «${acc.name}» رئيسي؛ اختر حسابًا فرعيًا`);
      if (l.party_id) {
        const p = await mustGet(t, 'parties', l.party_id, 'الطرف');
        const need = p.kind === 'customer' ? 'ar' : 'ap';
        if (acc.system_key !== need) throw new AppError(`الطرف «${p.name}» يُستخدم فقط مع حساب ${p.kind === 'customer' ? 'العملاء' : 'الموردين'}`);
      } else if (acc.system_key === 'ar' || acc.system_key === 'ap') {
        throw new AppError('حدد العميل/المورد في سطر حساب العملاء أو الموردين');
      }
    }
    total = dr;
  }
  if (input.doc_type === 'party_opening' && !input.side) throw new AppError('حدد طبيعة الرصيد (مدين/دائن)');
  if (input.doc_type === 'stock_adjustment' && !input.notes?.trim()) throw new AppError('سبب الجرد/التسوية مطلوب');

  if (input.ref_doc_id) {
    const ref = await t.one(`select * from documents where id = $1`, [input.ref_doc_id]);
    if (!ref) throw new AppError('المستند المرجعي غير موجود');
    if (info.refType && ref.doc_type !== info.refType) throw new AppError('المستند المرجعي من نوع غير مناسب');
    if (ref.status !== 'posted') throw new AppError('المستند المرجعي غير مُرحّل');
    if (info.partyKind && ref.party_id !== input.party_id) throw new AppError('الطرف يختلف عن طرف المستند المرجعي');
  }

  // ---- الحفظ
  const header = {
    doc_type: input.doc_type,
    date: input.date,
    party_id: input.party_id ?? null,
    warehouse_id: input.warehouse_id ?? null,
    to_warehouse_id: input.to_warehouse_id ?? null,
    cashbox_id: input.cashbox_id ?? null,
    account_id: input.account_id ?? null,
    payment_type: info.priced ? (input.payment_type ?? (paid >= total ? 'cash' : 'credit')) : null,
    side: input.side ?? null,
    ref_doc_id: input.ref_doc_id ?? null,
    gross,
    discount,
    tax,
    total,
    paid,
    notes: input.notes ?? null,
    data: JSON.stringify({ journal_lines: input.journal_lines }),
    local_number: input.local_number ?? null,
  };
  const cols = Object.keys(header);
  if (existing) {
    await t.query(
      `update documents set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, status = 'draft', review_reason = null where id = $1`,
      [input.id, ...cols.map((c) => (header as any)[c])],
    );
    await t.query(`delete from document_lines where document_id = $1`, [input.id]);
  } else {
    const number = await nextNumber(t, input.doc_type);
    await t.query(
      `insert into documents (id, number, status, created_by, device_id, ${cols.join(', ')}) values ($1, $2, 'draft', $3, $4, ${cols.map((_, i) => `$${i + 5}`).join(', ')})`,
      [input.id, number, ctx.user.id, ctx.deviceId, ...cols.map((c) => (header as any)[c])],
    );
  }
  for (const [i, l] of lines.entries()) {
    const c = computed[i];
    await t.query(
      `insert into document_lines (id, document_id, line_no, item_id, unit_name, unit_factor, qty, base_qty, price, discount, doc_discount, tax_rate_bp, tax, total, ref_line_id, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        l.id, input.id, l.line_no, l.item_id, l.unit_name, l.unit_factor, l.qty, l.base_qty, l.price,
        c?.line_discount ?? 0, c?.doc_discount ?? 0, info.priced ? l.tax_rate_bp : 0, c?.tax ?? 0, c?.total ?? 0,
        l.ref_line_id ?? null, l.notes ?? null,
      ],
    );
  }
  return t.one(`select * from documents where id = $1`, [input.id]);
}

async function partyPriceList(t: Db, partyId?: string | null) {
  if (!partyId) return 'retail';
  return (await t.one(`select price_list from parties where id = $1`, [partyId]))?.price_list ?? 'retail';
}

export interface PostOpts {
  /** تجاوز فحص الرصيد/الحد الائتماني (بعد مراجعة مستخدم مخول) */
  override?: boolean;
}

/**
 * ترحيل مستند: كل الآثار (مخزون، قيود، أرصدة) داخل نفس المعاملة.
 */
export async function postDocument(t: Db, ctx: Ctx, docId: string, opts: PostOpts = {}) {
  const doc = await t.one(`select * from documents where id = $1 for update`, [docId]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  if (doc.status === 'posted') throw new AppError('المستند مُرحّل بالفعل', 'state');
  if (doc.status === 'cancelled') throw new AppError('المستند ملغي', 'state');
  const lines = await t.query(`select * from document_lines where document_id = $1 order by line_no`, [docId]);
  const settings = await getSettings(t);
  const allowNegative = !!settings.allow_negative_stock || !!opts.override;
  const date: string = doc.date;
  const uid = ctx.user.id;
  const jl: JLine[] = [];
  const acc = (k: Parameters<typeof sysAccount>[1]) => sysAccount(t, k);
  const cashAcc = async () => {
    const cb = await t.one(`select account_id from cashboxes where id = $1`, [doc.cashbox_id]);
    if (!cb) throw new AppError('الخزينة غير موجودة');
    return cb.account_id as string;
  };
  const party = doc.party_id ? await t.one(`select * from parties where id = $1`, [doc.party_id]) : undefined;
  const partyAcc = async () => (party?.kind === 'supplier' ? acc('ap') : acc('ar'));
  const memo = `${DOC_TYPES[doc.doc_type as DocType].label} ${doc.number}`;
  const netOfTax = doc.total - doc.tax;

  switch (doc.doc_type as DocType) {
    case 'sale_invoice': {
      if (settings.enforce_credit_limit && !opts.override && party && party.credit_limit > 0) {
        const after = party.balance + (doc.total - doc.paid);
        if (doc.total - doc.paid > 0 && after > party.credit_limit) {
          throw new ReviewError('credit_limit', `تجاوز الحد الائتماني للعميل «${party.name}»`, { balance: party.balance, limit: party.credit_limit, after });
        }
      }
      let cost = 0;
      for (const l of lines) {
        const c = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, c]);
        cost += c;
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ar = await acc('ar');
      jl.push({ account_id: ar, party_id: doc.party_id, debit: doc.total, credit: 0, memo });
      jl.push({ account_id: await acc('sales'), debit: 0, credit: doc.gross, memo });
      jl.push({ account_id: await acc('sales_discount'), debit: doc.discount, credit: 0, memo });
      jl.push({ account_id: await acc('vat_output'), debit: 0, credit: doc.tax, memo });
      if (doc.paid > 0) {
        jl.push({ account_id: await cashAcc(), debit: doc.paid, credit: 0, memo: `تحصيل ${memo}` });
        jl.push({ account_id: ar, party_id: doc.party_id, debit: 0, credit: doc.paid, memo: `تحصيل ${memo}` });
      }
      jl.push({ account_id: await acc('cogs'), debit: cost, credit: 0, memo });
      jl.push({ account_id: await acc('inventory'), debit: 0, credit: cost, memo });
      break;
    }
    case 'sale_return': {
      await checkReturnQty(t, doc, lines);
      let cost = 0;
      for (const l of lines) {
        let value: number;
        const refLine = l.ref_line_id ? await t.one(`select cost, base_qty from document_lines where id = $1`, [l.ref_line_id]) : undefined;
        if (refLine && refLine.base_qty > 0) value = Math.round((refLine.cost * l.base_qty) / refLine.base_qty);
        else {
          const it = await t.one(`select avg_cost from items where id = $1`, [l.item_id]);
          value = Math.round((l.base_qty * it.avg_cost) / 1000);
        }
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
        cost += value;
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ar = await acc('ar');
      jl.push({ account_id: await acc('sales_returns'), debit: netOfTax, credit: 0, memo });
      jl.push({ account_id: await acc('vat_output'), debit: doc.tax, credit: 0, memo });
      jl.push({ account_id: ar, party_id: doc.party_id, debit: 0, credit: doc.total, memo });
      if (doc.paid > 0) {
        jl.push({ account_id: ar, party_id: doc.party_id, debit: doc.paid, credit: 0, memo: `رد نقدية ${memo}` });
        jl.push({ account_id: await cashAcc(), debit: 0, credit: doc.paid, memo: `رد نقدية ${memo}` });
      }
      jl.push({ account_id: await acc('inventory'), debit: cost, credit: 0, memo });
      jl.push({ account_id: await acc('cogs'), debit: 0, credit: cost, memo });
      break;
    }
    case 'purchase_invoice': {
      for (const l of lines) {
        const value = l.total - l.tax; // صافي التكلفة بعد الخصومات وبدون الضريبة القابلة للخصم
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id, setLastCost: true });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, netOfTax]);
      const ap = await acc('ap');
      jl.push({ account_id: await acc('inventory'), debit: netOfTax, credit: 0, memo });
      jl.push({ account_id: await acc('vat_input'), debit: doc.tax, credit: 0, memo });
      jl.push({ account_id: ap, party_id: doc.party_id, debit: 0, credit: doc.total, memo });
      if (doc.paid > 0) {
        jl.push({ account_id: ap, party_id: doc.party_id, debit: doc.paid, credit: 0, memo: `سداد ${memo}` });
        jl.push({ account_id: await cashAcc(), debit: 0, credit: doc.paid, memo: `سداد ${memo}` });
      }
      break;
    }
    case 'purchase_return': {
      await checkReturnQty(t, doc, lines);
      let cost = 0;
      for (const l of lines) {
        const c = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, c]);
        cost += c;
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ap = await acc('ap');
      jl.push({ account_id: ap, party_id: doc.party_id, debit: doc.total, credit: 0, memo });
      jl.push({ account_id: await acc('vat_input'), debit: 0, credit: doc.tax, memo });
      jl.push({ account_id: await acc('inventory'), debit: 0, credit: cost, memo });
      const variance = netOfTax - cost; // فرق بين قيمة المرتجع بسعر الشراء والتكلفة المتوسطة
      if (variance > 0) jl.push({ account_id: await acc('cost_variance'), debit: 0, credit: variance, memo });
      if (variance < 0) jl.push({ account_id: await acc('cost_variance'), debit: -variance, credit: 0, memo });
      if (doc.paid > 0) {
        jl.push({ account_id: await cashAcc(), debit: doc.paid, credit: 0, memo: `استرداد ${memo}` });
        jl.push({ account_id: ap, party_id: doc.party_id, debit: 0, credit: doc.paid, memo: `استرداد ${memo}` });
      }
      break;
    }
    case 'receipt':
    case 'payment': {
      const counter = doc.party_id ? await partyAcc() : doc.account_id;
      const isReceipt = doc.doc_type === 'receipt';
      const cash = await cashAcc();
      jl.push({ account_id: cash, debit: isReceipt ? doc.total : 0, credit: isReceipt ? 0 : doc.total, memo: doc.notes ?? memo });
      jl.push({ account_id: counter, party_id: doc.party_id, debit: isReceipt ? 0 : doc.total, credit: isReceipt ? doc.total : 0, memo: doc.notes ?? memo });
      if (doc.ref_doc_id) await applyToInvoice(t, doc, +1);
      break;
    }
    case 'expense':
    case 'income': {
      const cash = await cashAcc();
      const isExp = doc.doc_type === 'expense';
      jl.push({ account_id: doc.account_id, debit: isExp ? doc.total : 0, credit: isExp ? 0 : doc.total, memo: doc.notes ?? memo });
      jl.push({ account_id: cash, debit: isExp ? 0 : doc.total, credit: isExp ? doc.total : 0, memo: doc.notes ?? memo });
      break;
    }
    case 'stock_transfer': {
      for (const l of lines) {
        const value = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.to_warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
      }
      break;
    }
    case 'stock_adjustment': {
      let net = 0;
      for (const l of lines) {
        const sys = await currentQty(t, l.item_id, doc.warehouse_id);
        const diff = l.base_qty - sys;
        let value = 0;
        if (diff > 0) {
          const it = await t.one(`select avg_cost, last_cost from items where id = $1`, [l.item_id]);
          value = Math.round((diff * (it.avg_cost || it.last_cost)) / 1000);
          await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: diff, value, document_id: docId, line_id: l.id });
        } else if (diff < 0) {
          value = -(await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: -diff, allowNegative: true, document_id: docId, line_id: l.id }));
        }
        await t.query(`update document_lines set system_qty = $2, cost = $3 where id = $1`, [l.id, sys, value]);
        net += value;
      }
      const inv = await acc('inventory');
      const diffAcc = await acc('inventory_diff');
      if (net > 0) jl.push({ account_id: inv, debit: net, credit: 0, memo }, { account_id: diffAcc, debit: 0, credit: net, memo });
      if (net < 0) jl.push({ account_id: diffAcc, debit: -net, credit: 0, memo }, { account_id: inv, debit: 0, credit: -net, memo });
      await t.query(`update documents set cost = $2 where id = $1`, [docId, net]);
      break;
    }
    case 'opening_stock': {
      let total = 0;
      for (const l of lines) {
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value: l.total, document_id: docId, line_id: l.id, setLastCost: true });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, l.total]);
        total += l.total;
      }
      jl.push({ account_id: await acc('inventory'), debit: total, credit: 0, memo });
      jl.push({ account_id: await acc('opening_equity'), debit: 0, credit: total, memo });
      break;
    }
    case 'party_opening': {
      const pa = await partyAcc();
      const oe = await acc('opening_equity');
      const debitParty = doc.side === 'debit';
      jl.push({ account_id: pa, party_id: doc.party_id, debit: debitParty ? doc.total : 0, credit: debitParty ? 0 : doc.total, memo });
      jl.push({ account_id: oe, debit: debitParty ? 0 : doc.total, credit: debitParty ? doc.total : 0, memo });
      break;
    }
    case 'journal_voucher': {
      for (const l of doc.data?.journal_lines ?? []) jl.push({ ...l, memo: l.memo ?? doc.notes ?? memo });
      break;
    }
  }

  await writeJournal(t, { date, document_id: docId, memo: doc.notes ? `${memo} — ${doc.notes}` : memo, lines: jl, created_by: uid });
  await t.query(`update documents set status = 'posted', posted_by = $2, posted_at = now(), review_reason = null where id = $1`, [docId, uid]);
  return t.one(`select * from documents where id = $1`, [docId]);
}

async function applyToInvoice(t: Db, doc: any, sign: 1 | -1) {
  const inv = await t.one(`select * from documents where id = $1 for update`, [doc.ref_doc_id]);
  if (!inv) throw new AppError('الفاتورة المرتبطة غير موجودة');
  const ok =
    (doc.doc_type === 'receipt' && inv.doc_type === 'sale_invoice') || (doc.doc_type === 'payment' && inv.doc_type === 'purchase_invoice');
  if (!ok) throw new AppError('نوع الفاتورة المرتبطة لا يناسب السند');
  if (inv.party_id !== doc.party_id) throw new AppError('طرف السند يختلف عن طرف الفاتورة');
  const newPaid = inv.paid + sign * doc.total;
  if (sign > 0 && newPaid > inv.total) throw new AppError('المبلغ أكبر من المتبقي على الفاتورة');
  await t.query(`update documents set paid = $2 where id = $1`, [inv.id, newPaid]);
}

/** لا يُسمح بإرجاع أكثر مما بيع/اشتُري في الفاتورة الأصلية */
async function checkReturnQty(t: Db, doc: any, lines: any[]) {
  if (!doc.ref_doc_id) return;
  const refLines = await t.query(`select * from document_lines where document_id = $1`, [doc.ref_doc_id]);
  const returned = await t.query(
    `select l.ref_line_id, sum(l.base_qty)::bigint as q from document_lines l join documents d on d.id = l.document_id
      where d.ref_doc_id = $1 and d.status = 'posted' and d.id <> $2 group by l.ref_line_id`,
    [doc.ref_doc_id, doc.id],
  );
  const retMap = new Map(returned.map((r) => [r.ref_line_id, r.q]));
  for (const l of lines) {
    const rl = refLines.find((x) => x.id === l.ref_line_id);
    if (!rl) throw new AppError('كل سطر في المرتجع يجب أن يرتبط بسطر من الفاتورة الأصلية');
    if (rl.item_id !== l.item_id) throw new AppError('صنف المرتجع يختلف عن صنف الفاتورة');
    const already = retMap.get(l.ref_line_id) ?? 0;
    if (already + l.base_qty > rl.base_qty) throw new AppError('كمية المرتجع أكبر من المتبقي في الفاتورة الأصلية');
    retMap.set(l.ref_line_id, already + l.base_qty);
  }
}

/** إلغاء مستند: المسودة تُلغى مباشرة، والمرحّل يُعكس بقيد عكسي وحركات مخزون عكسية مع الاحتفاظ بالأصل */
export async function cancelDocument(t: Db, ctx: Ctx, docId: string, reason: string) {
  const doc = await t.one(`select * from documents where id = $1 for update`, [docId]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  if (doc.status === 'cancelled') throw new AppError('المستند ملغي بالفعل', 'state');
  if (doc.status === 'posted') {
    const deps = await t.one(`select count(*)::int as n from documents where ref_doc_id = $1 and status = 'posted'`, [docId]);
    if (deps && deps.n > 0) throw new AppError('لا يمكن الإلغاء: توجد مستندات مرحّلة مرتبطة به (مرتجعات أو سندات). ألغها أولًا', 'state');
    const today = new Date().toISOString().slice(0, 10);
    const date = doc.date > today ? doc.date : today;
    await reverseStockMoves(t, docId, date);
    await reverseDocumentJournals(t, docId, date, ctx.user.id, `إلغاء ${DOC_TYPES[doc.doc_type as DocType].label} ${doc.number}: ${reason}`);
    if (doc.ref_doc_id && (doc.doc_type === 'receipt' || doc.doc_type === 'payment')) await applyToInvoice(t, doc, -1);
  }
  await t.query(`update documents set status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now() where id = $1`, [docId, reason, ctx.user.id]);
  return t.one(`select * from documents where id = $1`, [docId]);
}
