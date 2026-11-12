import {
  allocateByBp, applyBp, computeDocument, DOC_TYPES, hasPermission, mulDiv, toBaseQty, type DocInput, type DocType,
} from '@erp/shared';
import type { AuthUser } from '../auth';
import type { Db } from '../db';
import { AppError, ReviewError } from '../errors';
import { cashResult, incomeStatement } from '../reports';
import { getSettings, reverseDocumentJournals, sysAccount, writeJournal, type JLine } from './ledger';
import { currentQty, reverseStockMoves, stockIn, stockOut } from './stock';
import { reverseTracking, trackIn, trackOut, trackTransfer } from './tracking';

export interface Ctx {
  user: AuthUser;
  deviceId: string;
  opId?: string;
}

export const CASH_CUSTOMER_ID = 'party-cash-customer';
const CASH_DOCS = ['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'partner_capital', 'partner_withdrawal'];

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

function allowed(list: string[] | null | undefined, id: string | null | undefined) {
  return !id || !list || list.includes(id);
}

/** السعر المتوقع حسب قائمة الأسعار ثم سعر الوحدة ثم سعر الصنف */
export async function expectedPrice(t: Db, item: any, unitName: string, factor: number, priceListId: string | null) {
  if (priceListId) {
    const p = await t.one(`select price from item_prices where item_id = $1 and unit_name = $2 and price_list_id = $3`, [item.id, unitName, priceListId]);
    if (p) return p.price as number;
  }
  if (unitName !== item.base_unit) {
    const u = await t.one(`select * from item_units where item_id = $1 and name = $2`, [item.id, unitName]);
    if (priceListId === 'pl-wholesale' && u?.wholesale_price) return u.wholesale_price;
    if (u?.sale_price) return u.sale_price;
  } else if (priceListId === 'pl-wholesale' && item.wholesale_price) return item.wholesale_price;
  return mulDiv(item.sale_price, factor, 1000);
}

export function paymentFee(cb: any, amount: number) {
  if (!cb || amount <= 0 || (!cb.fee_bp && !cb.fee_min && !cb.fee_fixed)) return 0;
  return Math.max(applyBp(amount, cb.fee_bp ?? 0), cb.fee_min ?? 0) + (cb.fee_fixed ?? 0);
}

export async function assertPeriodOpen(t: Db, date: string) {
  const s = await t.one(`select value from settings where key = 'locked_until'`);
  const locked = s?.value;
  if (locked && date <= locked) throw new AppError(`الفترة حتى ${locked} مقفلة؛ لا يمكن الترحيل أو الإلغاء بتاريخ ${date}`, 'state');
}

/** الكمية المحجوزة بعروض الأسعار السارية (عدا عرض معين) */
async function reservedQty(t: Db, itemId: string, whId: string, excludeQuotation?: string | null) {
  const r = await t.one(
    `select coalesce(sum(l.base_qty), 0)::bigint as q from document_lines l join documents d on d.id = l.document_id
      where d.doc_type = 'quotation' and d.reserve and d.status = 'posted' and d.converted_to_id is null
        and l.item_id = $1 and d.warehouse_id = $2 and d.id <> coalesce($3, '')`,
    [itemId, whId, excludeQuotation ?? null],
  );
  return r?.q ?? 0;
}

// =====================================================================================
// الحفظ (مسودة) — تحقق وحساب بدون أثر محاسبي
// =====================================================================================
export async function saveDocument(t: Db, ctx: Ctx, input: DocInput, existing?: any) {
  const info = DOC_TYPES[input.doc_type];
  if (!info) throw new AppError('نوع مستند غير معروف');
  const perms = ctx.user.permissions;
  const can = (k: string) => hasPermission(perms, k);
  const isSaleSide = input.doc_type === 'sale_invoice' || input.doc_type === 'sale_return' || input.doc_type === 'quotation';

  // ---- الأطراف
  let party: any;
  if (info.partyKind) {
    if (input.party_id) {
      party = await mustGet(t, 'parties', input.party_id, 'الطرف');
      if (info.partyKind !== 'any' && party.kind !== info.partyKind) throw new AppError(info.partyKind === 'customer' ? 'يجب اختيار عميل' : 'يجب اختيار مورد');
    } else if (info.partyKind === 'supplier' || input.doc_type === 'party_opening') {
      throw new AppError('اختر الطرف');
    } else if (isSaleSide) {
      input.party_id = CASH_CUSTOMER_ID;
      party = await t.one(`select * from parties where id = $1`, [CASH_CUSTOMER_ID]);
    }
  }
  if (info.stock || input.doc_type === 'quotation') {
    await mustGet(t, 'warehouses', input.warehouse_id, 'المخزن');
    if (!allowed(ctx.user.warehouse_ids, input.warehouse_id)) throw new AppError('غير مسموح لك بالعمل على هذا المخزن', 'forbidden');
  }
  if (info.stock === 'transfer') {
    await mustGet(t, 'warehouses', input.to_warehouse_id, 'المخزن المحوّل إليه');
    if (input.to_warehouse_id === input.warehouse_id) throw new AppError('لا يمكن التحويل لنفس المخزن');
  }
  if (input.sales_rep_id) await mustGet(t, 'sales_reps', input.sales_rep_id, 'المندوب');
  if (info.hasLines && !input.lines.length) throw new AppError('أضف صنفًا واحدًا على الأقل');

  // ---- المرتجع بدون فاتورة أصلية يحتاج صلاحية
  if (info.refType && !input.ref_doc_id && !can(`${info.module}.free_return`)) {
    throw new AppError('اختر الفاتورة الأصلية للمرتجع (ليس لديك صلاحية المرتجع بدون فاتورة)', 'forbidden');
  }

  // ---- قائمة الأسعار
  const priceListId = isSaleSide ? input.price_list_id || party?.price_list_id || 'pl-retail' : null;

  // ---- الأصناف
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    const item = await mustGet(t, 'items', l.item_id, 'الصنف');
    let factor = 1000;
    if (l.unit_name !== item.base_unit) {
      const u = await t.one(`select * from item_units where item_id = $1 and name = $2 and active`, [l.item_id, l.unit_name]);
      if (!u) throw new AppError(`الوحدة «${l.unit_name}» غير معرفة للصنف «${item.name}»`);
      factor = u.factor;
    }
    if (l.unit_factor !== factor) throw new AppError(`معامل تحويل الوحدة للصنف «${item.name}» تغير؛ أعد اختيار الوحدة`);
    if (isSaleSide && input.doc_type !== 'sale_return' && !can('sales.price_change')) {
      const exp = await expectedPrice(t, item, l.unit_name, factor, priceListId);
      if (l.price !== exp) throw new AppError(`ليس لديك صلاحية تغيير سعر «${item.name}»`, 'forbidden');
    }
    if (info.stock === 'adjust') {
      if (l.qty < 0) throw new AppError('الكمية الفعلية لا تكون سالبة');
    } else if (l.qty <= 0) throw new AppError(`كمية الصنف «${item.name}» يجب أن تكون أكبر من صفر`);
    if (item.is_service && info.stock && info.stock !== 'out' && info.stock !== 'in') throw new AppError(`«${item.name}» خدمة وليس لها مخزون`);
    lines.push({ ...l, line_no: i + 1, base_qty: toBaseQty(l.qty, factor), item });
  }

  if (isSaleSide && !can('sales.discount')) {
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
  } else if (!info.hasLines && !['journal_voucher', 'profit_distribution', 'year_closing'].includes(input.doc_type)) {
    if (input.amount <= 0) throw new AppError('المبلغ يجب أن يكون أكبر من صفر');
    total = input.amount;
  }

  // ---- إضافات ومصروفات الفاتورة
  const charges = input.doc_type === 'sale_invoice' || input.doc_type === 'purchase_invoice' ? input.charges ?? [] : [];
  if ((input.charges ?? []).length && !charges.length) throw new AppError('الإضافات والمصروفات متاحة في فواتير البيع والشراء فقط');
  for (const ch of charges) {
    if (ch.mode === 'expense') {
      await mustGet(t, 'cashboxes', ch.cashbox_id, 'خزينة المصروف');
      if (!allowed(ctx.user.cashbox_ids, ch.cashbox_id)) throw new AppError('غير مسموح لك بالعمل على هذه الخزينة', 'forbidden');
    }
    if (ch.account_id) {
      const acc = await mustGet(t, 'accounts', ch.account_id, 'حساب الإضافة/المصروف');
      if (acc.is_group) throw new AppError('اختر حسابًا فرعيًا للإضافة/المصروف');
    }
  }
  const chargesAdd = charges.filter((c) => c.mode === 'add').reduce((s, c) => s + c.amount, 0);
  total += chargesAdd;
  if (input.deliver_later && input.doc_type !== 'sale_invoice') throw new AppError('التسليم المؤجل لفواتير البيع فقط');

  // ---- حدود الخصم وأقل سعر (بيع)
  if (isSaleSide && input.doc_type !== 'sale_return') {
    const lim = ctx.user.limits ?? {};
    if (lim.max_discount_amount && discount > lim.max_discount_amount) throw new AppError('الخصم أكبر من الحد المسموح لك', 'forbidden');
    if (lim.max_discount_bp && gross > 0 && discount * 10000 > lim.max_discount_bp * gross) throw new AppError(`نسبة الخصم أكبر من الحد المسموح لك (${lim.max_discount_bp / 100}%)`, 'forbidden');
    for (const [i, l] of lines.entries()) {
      const net = (computed[i]?.taxable ?? 0) * 1000;
      if (l.item.min_price && net < l.item.min_price * l.base_qty && !can('sales.below_min_price')) {
        throw new AppError(`سعر «${l.item.name}» أقل من أقل سعر بيع مسموح`, 'forbidden');
      }
      if (!l.item.is_service && l.item.avg_cost && net < l.item.avg_cost * l.base_qty && !can('sales.below_cost')) {
        throw new AppError(`سعر «${l.item.name}» أقل من التكلفة`, 'forbidden');
      }
    }
  }

  // ---- السداد
  let payments = input.payments ?? [];
  let instruments = input.instruments ?? [];
  let paid = 0;
  if (info.priced && !info.noPosting) {
    if (!payments.length && (input.payment_type === 'cash' || input.party_id === CASH_CUSTOMER_ID) && total > 0) {
      if (!input.cashbox_id) throw new AppError('اختر الخزينة');
      payments = [{ id: crypto.randomUUID(), cashbox_id: input.cashbox_id, amount: total - instruments.reduce((s, x) => s + x.amount, 0) }].filter((p) => p.amount > 0);
    } else if (!payments.length && input.paid > 0) {
      if (!input.cashbox_id) throw new AppError('اختر الخزينة');
      payments = [{ id: crypto.randomUUID(), cashbox_id: input.cashbox_id, amount: input.paid }];
    }
    for (const p of payments) {
      await mustGet(t, 'cashboxes', p.cashbox_id, 'الخزينة');
      if (!allowed(ctx.user.cashbox_ids, p.cashbox_id)) throw new AppError('غير مسموح لك بالعمل على هذه الخزينة', 'forbidden');
    }
    if (instruments.length && !(input.doc_type === 'sale_invoice' || input.doc_type === 'purchase_invoice')) throw new AppError('الشيكات والأقساط متاحة في الفواتير فقط');
    if (instruments.length && input.party_id === CASH_CUSTOMER_ID) throw new AppError('الشيكات والأقساط تحتاج عميلًا مسجلًا');
    const cashPaid = payments.reduce((s, p) => s + p.amount, 0);
    const instTotal = instruments.reduce((s, x) => s + x.amount, 0);
    if (cashPaid + instTotal > total) throw new AppError('المدفوع والشيكات والأقساط أكبر من إجمالي الفاتورة');
    if (input.party_id === CASH_CUSTOMER_ID && cashPaid < total) throw new AppError('العميل النقدي يجب أن يسدد كامل الفاتورة؛ اختر عميلًا مسجلًا للبيع الآجل');
    const chequePaid = instruments.filter((x) => x.kind === 'cheque').reduce((s, x) => s + x.amount, 0);
    paid = cashPaid + chequePaid;
    if (input.doc_type === 'sale_invoice' && total - cashPaid > 0 && !can('sales.credit')) throw new AppError('ليس لديك صلاحية البيع الآجل', 'forbidden');
  } else {
    payments = [];
    instruments = [];
  }
  if (CASH_DOCS.includes(input.doc_type)) {
    await mustGet(t, 'cashboxes', input.cashbox_id, 'الخزينة');
    if (!allowed(ctx.user.cashbox_ids, input.cashbox_id)) throw new AppError('غير مسموح لك بالعمل على هذه الخزينة', 'forbidden');
    paid = total;
  }

  // ---- السندات
  if (['receipt', 'payment', 'expense', 'income'].includes(input.doc_type)) {
    if (!input.party_id && !input.account_id) throw new AppError('اختر الطرف أو الحساب');
    if (input.account_id) {
      const acc = await mustGet(t, 'accounts', input.account_id, 'الحساب');
      if (acc.is_group) throw new AppError('اختر حسابًا فرعيًا وليس رئيسيًا');
      if (input.doc_type === 'expense' && acc.type !== 'expense') throw new AppError('اختر حساب مصروف');
      if (input.doc_type === 'income' && acc.type !== 'revenue') throw new AppError('اختر حساب إيراد');
    }
  }
  if (input.doc_type === 'cash_transfer') {
    await mustGet(t, 'cashboxes', input.to_cashbox_id, 'الخزينة المحوّل إليها');
    if (input.to_cashbox_id === input.cashbox_id) throw new AppError('اختر خزينة مختلفة للتحويل إليها');
  }
  if (input.doc_type === 'partner_capital' || input.doc_type === 'partner_withdrawal') {
    await mustGet(t, 'partners', input.partner_id, 'الشريك');
  }

  // ---- توزيع الأرباح: يُحسب من القيود المرحّلة للفترة
  let distData: any = null;
  if (input.doc_type === 'profit_distribution') {
    if (!input.period_from || !input.period_to || input.period_from > input.period_to) throw new AppError('حدد فترة صحيحة للتوزيع');
    const overlap = await t.one(
      `select number from documents where doc_type = 'profit_distribution' and status = 'posted' and id <> $3
        and (data->>'period_from') <= $2 and (data->>'period_to') >= $1 limit 1`,
      [input.period_from, input.period_to, input.id],
    );
    if (overlap) throw new AppError(`يوجد توزيع مرحّل (${overlap.number}) يتداخل مع هذه الفترة`);
    const partners = await t.query(`select * from partners where active order by name`);
    if (!partners.length) throw new AppError('لا يوجد شركاء نشطون');
    const sumBp = partners.reduce((s, p) => s + p.profit_bp, 0);
    if (sumBp !== 10000) throw new AppError(`مجموع نسب توزيع الأرباح ${sumBp / 100}% ولا يساوي 100% (الفرق ${(10000 - sumBp) / 100}%). عدّل نسب الشركاء أولًا`);
    const is = await incomeStatement(t, { from: input.period_from, to: input.period_to });
    const basis = input.profit_basis === 'cash' ? 'cash' : 'accrual';
    const cash = basis === 'cash' ? await cashResult(t, { from: input.period_from, to: input.period_to }) : null;
    const net = cash ? cash.result : is.net_profit;
    if (net <= 0) throw new AppError(`${cash ? 'النتيجة النقدية' : 'صافي ربح'} الفترة ${net / 100} — لا يوجد ربح قابل للتوزيع`);
    const retained = applyBp(net, input.retained_bp ?? 0);
    const distributable = net - retained;
    if (distributable <= 0) throw new AppError('لا يتبقى ربح للتوزيع بعد الاحتجاز');
    const shares = allocateByBp(distributable, partners.map((p) => ({ key: p.id, bp: p.profit_bp })));
    distData = {
      period_from: input.period_from,
      period_to: input.period_to,
      net_profit: net,
      profit_basis: basis,
      accrual_profit: is.net_profit,
      cash_result: cash?.result ?? null,
      revenue: is.total_revenue,
      expenses: is.total_expenses,
      retained_bp: input.retained_bp ?? 0,
      retained,
      shares: partners.map((p) => ({ partner_id: p.id, name: p.name, profit_bp: p.profit_bp, ownership_bp: p.ownership_bp, amount: shares[p.id] })),
    };
    total = distributable;
  }

  // ---- القيد اليدوي
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
  if (input.from_quotation_id) {
    const q = await t.one(`select * from documents where id = $1`, [input.from_quotation_id]);
    if (!q || q.doc_type !== 'quotation') throw new AppError('عرض الأسعار غير موجود');
    if (q.converted_to_id && q.converted_to_id !== input.id) throw new AppError(`عرض الأسعار ${q.number} حُوّل لفاتورة من قبل`);
  }
  if (input.shift_id) {
    const sh = await t.one(`select * from cashier_shifts where id = $1`, [input.shift_id]);
    if (!sh || sh.status !== 'open' || sh.user_id !== ctx.user.id) throw new AppError('الوردية المحددة غير مفتوحة لهذا المستخدم');
  }

  // تاريخ الاستحقاق للجزء الآجل
  let dueDate = input.due_date ?? null;
  if (info.priced && !info.noPosting && !dueDate && total - paid > 0 && (input.doc_type === 'sale_invoice' || input.doc_type === 'purchase_invoice')) {
    const settings = await getSettings(t);
    const days = party?.due_days || settings.default_due_days || 0;
    if (days > 0) {
      const d = new Date(input.date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      dueDate = d.toISOString().slice(0, 10);
    }
  }

  // ---- الحفظ
  const header = {
    doc_type: input.doc_type,
    date: input.date,
    party_id: input.party_id ?? null,
    warehouse_id: info.stock || input.doc_type === 'quotation' ? input.warehouse_id ?? null : null,
    to_warehouse_id: input.to_warehouse_id ?? null,
    cashbox_id: input.cashbox_id ?? payments[0]?.cashbox_id ?? null,
    to_cashbox_id: input.to_cashbox_id ?? null,
    account_id: input.account_id ?? null,
    partner_id: input.partner_id ?? null,
    sales_rep_id: input.sales_rep_id ?? null,
    price_list_id: priceListId,
    shift_id: input.shift_id ?? null,
    due_date: dueDate,
    reserve: input.doc_type === 'quotation' ? !!input.reserve : false,
    deliver_later: input.doc_type === 'sale_invoice' ? !!input.deliver_later : false,
    order_status: input.order_status ?? null,
    shipping_company: input.shipping_company ?? null,
    charges_total: chargesAdd,
    payment_type: info.priced ? (paid >= total ? 'cash' : 'credit') : null,
    side: input.side ?? null,
    ref_doc_id: input.ref_doc_id ?? null,
    gross,
    discount,
    tax,
    total,
    paid,
    notes: input.notes ?? null,
    data: JSON.stringify({
      journal_lines: input.journal_lines,
      payments,
      instruments,
      charges,
      from_quotation_id: input.from_quotation_id ?? null,
      ...(distData ?? {}),
    }),
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
      `insert into document_lines (id, document_id, line_no, item_id, unit_name, unit_factor, qty, base_qty, price, discount, doc_discount, tax_rate_bp, tax, total, ref_line_id, notes, serials, expiry)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        l.id, input.id, l.line_no, l.item_id, l.unit_name, l.unit_factor, l.qty, l.base_qty, l.price,
        c?.line_discount ?? 0, c?.doc_discount ?? 0, info.priced ? l.tax_rate_bp : 0, c?.tax ?? 0, c?.total ?? 0,
        l.ref_line_id ?? null, l.notes ?? null, JSON.stringify(l.serials ?? []), l.expiry ?? null,
      ],
    );
  }
  return t.one(`select * from documents where id = $1`, [input.id]);
}

export interface PostOpts {
  /** تجاوز فحص الرصيد/الحد الائتماني (بعد مراجعة مستخدم مخول) */
  override?: boolean;
}

// =====================================================================================
// التخصيص على الفواتير
// =====================================================================================

/** تخصيص مبلغ مستند (قبض/صرف/مرتجع) على فاتورة محددة أو تلقائيًا على أقدم الفواتير المفتوحة */
export async function allocate(t: Db, source: any, amount: number, invoiceType: 'sale_invoice' | 'purchase_invoice', invoiceId?: string | null) {
  if (amount <= 0) return 0;
  let remaining = amount;
  const apply = async (inv: any, amt: number) => {
    await t.query(`update documents set paid = paid + $2 where id = $1`, [inv.id, amt]);
    await t.query(`insert into allocations (source_id, invoice_id, amount) values ($1,$2,$3)`, [source.id, inv.id, amt]);
    remaining -= amt;
  };
  if (invoiceId) {
    const inv = await t.one(`select * from documents where id = $1 for update`, [invoiceId]);
    if (!inv) throw new AppError('الفاتورة المرتبطة غير موجودة');
    if (inv.doc_type !== invoiceType) throw new AppError('نوع الفاتورة المرتبطة لا يناسب السند');
    if (inv.party_id !== source.party_id) throw new AppError('طرف السند يختلف عن طرف الفاتورة');
    const open = inv.total - inv.paid;
    if (source.doc_type === 'receipt' || source.doc_type === 'payment') {
      if (amount > open) throw new AppError('المبلغ أكبر من المتبقي على الفاتورة');
    }
    if (open > 0) await apply(inv, Math.min(open, remaining));
  } else {
    const invs = await t.query(
      `select * from documents where doc_type = $1 and party_id = $2 and status = 'posted' and not closed and paid < total
        order by coalesce(due_date, date), date, created_at for update`,
      [invoiceType, source.party_id],
    );
    for (const inv of invs) {
      if (remaining <= 0) break;
      await apply(inv, Math.min(inv.total - inv.paid, remaining));
    }
  }
  const used = amount - remaining;
  if (used) await t.query(`update documents set allocated = allocated + $2 where id = $1`, [source.id, used]);
  return used;
}

async function reverseAllocations(t: Db, sourceId: string) {
  const rows = await t.query(`select * from allocations where source_id = $1 and not reversed`, [sourceId]);
  for (const a of rows) {
    await t.query(`update documents set paid = paid - $2 where id = $1`, [a.invoice_id, a.amount]);
    await t.query(`update allocations set reversed = true where id = $1`, [a.id]);
  }
  await t.query(`update documents set allocated = 0 where id = $1`, [sourceId]);
}

// =====================================================================================
// الترحيل
// =====================================================================================
export async function postDocument(t: Db, ctx: Ctx, docId: string, opts: PostOpts = {}) {
  const doc = await t.one(`select * from documents where id = $1 for update`, [docId]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  if (doc.status === 'posted') throw new AppError('المستند مُرحّل بالفعل', 'state');
  if (doc.status === 'cancelled') throw new AppError('المستند ملغي', 'state');
  await assertPeriodOpen(t, doc.date);
  const info = DOC_TYPES[doc.doc_type as DocType];
  const uid = ctx.user.id;

  if (info.noPosting) {
    // عرض الأسعار: يُعتمد دون أثر محاسبي؛ الحجز يُحسب من العروض المعتمدة
    if (doc.reserve && !opts.override) {
      const lines = await t.query(`select * from document_lines where document_id = $1`, [docId]);
      for (const l of lines) {
        const it = await t.one(`select name, is_service from items where id = $1`, [l.item_id]);
        if (it.is_service) continue;
        const avail = (await currentQty(t, l.item_id, doc.warehouse_id)) - (await reservedQty(t, l.item_id, doc.warehouse_id, docId));
        if (avail < l.base_qty) throw new ReviewError('stock_shortage', `لا تكفي الكمية المتاحة لحجز «${it.name}»`, { item_id: l.item_id, available: avail, requested: l.base_qty });
      }
    }
    await t.query(`update documents set status = 'posted', posted_by = $2, posted_at = now(), review_reason = null where id = $1`, [docId, uid]);
    return t.one(`select * from documents where id = $1`, [docId]);
  }

  const lines = await t.query(`select * from document_lines where document_id = $1 order by line_no`, [docId]);
  const settings = await getSettings(t);
  const allowNegative = !!settings.allow_negative_stock || !!opts.override;
  const date: string = doc.date;
  const jl: JLine[] = [];
  const acc = (k: Parameters<typeof sysAccount>[1]) => sysAccount(t, k);
  const cbAccount = async (id: string) => {
    const cb = await t.one(`select account_id from cashboxes where id = $1`, [id]);
    if (!cb) throw new AppError('الخزينة غير موجودة');
    return cb.account_id as string;
  };
  const party = doc.party_id ? await t.one(`select * from parties where id = $1`, [doc.party_id]) : undefined;
  const partyAcc = async () => (party?.kind === 'supplier' ? acc('ap') : acc('ar'));
  const memo = `${info.label} ${doc.number}`;
  const netOfTax = doc.total - doc.tax;
  const data = doc.data ?? {};
  const payments: { id: string; cashbox_id: string; amount: number }[] = data.payments ?? [];
  const instruments: any[] = data.instruments ?? [];
  const itemOf = async (id: string) => t.one(`select * from items where id = $1`, [id]);

  /** السداد المتعدد: قيد لكل خزينة + عمولة الطريقة */
  const postPayments = async (direction: 'in' | 'out', counterAcc: string, label: string) => {
    for (const p of payments) {
      const cb = await t.one(`select * from cashboxes where id = $1`, [p.cashbox_id]);
      const fee = paymentFee(cb, p.amount);
      const cash = cb.account_id;
      if (direction === 'in') {
        jl.push({ account_id: cash, debit: p.amount, credit: 0, memo: `${label} ${memo}` });
        jl.push({ account_id: counterAcc, party_id: doc.party_id, debit: 0, credit: p.amount, memo: `${label} ${memo}` });
      } else {
        jl.push({ account_id: counterAcc, party_id: doc.party_id, debit: p.amount, credit: 0, memo: `${label} ${memo}` });
        jl.push({ account_id: cash, debit: 0, credit: p.amount, memo: `${label} ${memo}` });
      }
      if (fee > 0) {
        jl.push({ account_id: await acc('payment_fees'), debit: fee, credit: 0, memo: `عمولة ${cb.name} — ${memo}` });
        jl.push({ account_id: cash, debit: 0, credit: fee, memo: `عمولة ${cb.name} — ${memo}` });
      }
      await t.query(`insert into document_payments (id, document_id, cashbox_id, amount, fee) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [p.id, docId, p.cashbox_id, p.amount, fee]);
    }
  };
  const createInstruments = async (direction: 'in' | 'out') => {
    for (const x of instruments) {
      await t.query(
        `insert into instruments (id, kind, direction, document_id, party_id, amount, due_date, cheque_no, bank, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [x.id, x.kind, direction, docId, doc.party_id, x.amount, x.due_date, x.cheque_no ?? null, x.bank ?? null, x.notes ?? null],
      );
    }
  };

  switch (doc.doc_type as DocType) {
    case 'sale_invoice': {
      const cashPaid = payments.reduce((s, p) => s + p.amount, 0);
      if (settings.enforce_credit_limit && !opts.override && party && party.credit_limit > 0) {
        const after = party.balance + (doc.total - doc.paid);
        if (doc.total - cashPaid > 0 && after > party.credit_limit) {
          throw new ReviewError('credit_limit', `تجاوز الحد الائتماني للعميل «${party.name}»`, { balance: party.balance, limit: party.credit_limit, after });
        }
      }
      let cost = 0;
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        if (item.is_service) continue;
        const reserved = await reservedQty(t, l.item_id, doc.warehouse_id, data.from_quotation_id);
        if (reserved && !allowNegative) {
          const avail = (await currentQty(t, l.item_id, doc.warehouse_id)) - reserved;
          if (avail < l.base_qty) throw new ReviewError('stock_shortage', `الكمية المتاحة من «${item.name}» بعد الحجوزات غير كافية`, { item_id: l.item_id, available: avail, requested: l.base_qty });
        }
        const c = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        // في التسليم المؤجل يُسجل السيريال وقت التسليم الفعلي
        await trackOut(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty }, 'sell', { skipSerial: !!doc.deliver_later });
        await t.query(`update document_lines set cost = $2, delivered_qty = $3 where id = $1`, [l.id, c, doc.deliver_later ? 0 : l.base_qty]);
        cost += c;
      }
      // الخدمات لا تُسلّم؛ وفي التسليم الفوري يُعتبر كل شيء مسلّمًا
      await t.query(
        `update document_lines set delivered_qty = base_qty where document_id = $1 and ($2 = false or item_id in (select id from items where is_service))`,
        [docId, !!doc.deliver_later],
      );
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ar = await acc('ar');
      jl.push({ account_id: ar, party_id: doc.party_id, debit: doc.total, credit: 0, memo });
      jl.push({ account_id: await acc('sales'), debit: 0, credit: doc.gross, memo });
      for (const ch of (data.charges ?? []) as any[]) {
        if (ch.mode === 'add') {
          jl.push({ account_id: ch.account_id ?? (await acc('other_income')), debit: 0, credit: ch.amount, memo: `${ch.name} — ${memo}` });
        } else {
          jl.push({ account_id: ch.account_id ?? (await acc('misc_expense')), debit: ch.amount, credit: 0, memo: `${ch.name} — ${memo}` });
          jl.push({ account_id: await cbAccount(ch.cashbox_id), debit: 0, credit: ch.amount, memo: `${ch.name} — ${memo}` });
        }
      }
      jl.push({ account_id: await acc('sales_discount'), debit: doc.discount, credit: 0, memo });
      jl.push({ account_id: await acc('vat_output'), debit: 0, credit: doc.tax, memo });
      await postPayments('in', ar, 'تحصيل');
      for (const x of instruments.filter((i) => i.kind === 'cheque')) {
        jl.push({ account_id: await acc('notes_receivable'), debit: x.amount, credit: 0, memo: `شيك ${x.cheque_no ?? ''} — ${memo}` });
        jl.push({ account_id: ar, party_id: doc.party_id, debit: 0, credit: x.amount, memo: `شيك ${x.cheque_no ?? ''} — ${memo}` });
      }
      await createInstruments('in');
      jl.push({ account_id: await acc('cogs'), debit: cost, credit: 0, memo });
      jl.push({ account_id: await acc('inventory'), debit: 0, credit: cost, memo });
      if (data.from_quotation_id) await t.query(`update documents set converted_to_id = $2 where id = $1`, [data.from_quotation_id, docId]);
      break;
    }
    case 'sale_return': {
      await checkReturnQty(t, doc, lines);
      let cost = 0;
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        if (item.is_service) continue;
        let value: number;
        const refLine = l.ref_line_id ? await t.one(`select cost, base_qty from document_lines where id = $1`, [l.ref_line_id]) : undefined;
        if (refLine && refLine.base_qty > 0) value = mulDiv(refLine.cost, l.base_qty, refLine.base_qty);
        else value = mulDiv(l.base_qty, item.avg_cost || item.last_cost, 1000);
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id });
        await trackIn(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty });
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
        cost += value;
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ar = await acc('ar');
      jl.push({ account_id: await acc('sales_returns'), debit: netOfTax, credit: 0, memo });
      jl.push({ account_id: await acc('vat_output'), debit: doc.tax, credit: 0, memo });
      jl.push({ account_id: ar, party_id: doc.party_id, debit: 0, credit: doc.total, memo });
      await postPayments('out', ar, 'رد نقدية');
      jl.push({ account_id: await acc('inventory'), debit: cost, credit: 0, memo });
      jl.push({ account_id: await acc('cogs'), debit: 0, credit: cost, memo });
      // الجزء غير المردود نقدًا يُخفض المستحق على الفاتورة الأصلية (أو أقدم الفواتير)
      if (doc.party_id !== CASH_CUSTOMER_ID) await allocate(t, doc, doc.total - doc.paid, 'sale_invoice', doc.ref_doc_id);
      break;
    }
    case 'purchase_invoice': {
      // الإضافات والمصروفات تُحمّل على تكلفة الأصناف بالتناسب مع صافي قيمة كل سطر (landed cost)
      const chList = (data.charges ?? []) as any[];
      const chTotal = chList.reduce((s, c) => s + c.amount, 0);
      const netSum = lines.reduce((s, l) => s + (l.total - l.tax), 0);
      const shares = new Map<string, number>();
      if (chTotal > 0) {
        if (netSum <= 0) throw new AppError('لا يمكن تحميل المصروفات على فاتورة بدون قيمة');
        let used = 0;
        lines.forEach((l, i) => {
          const v = i === lines.length - 1 ? chTotal - used : mulDiv(chTotal, l.total - l.tax, netSum);
          shares.set(l.id, v);
          used += v;
        });
      }
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        const value = l.total - l.tax + (shares.get(l.id) ?? 0); // صافي التكلفة بعد الخصومات + نصيبه من المصروفات
        if (!item.is_service) {
          await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id, setLastCost: true });
          await trackIn(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty });
        }
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
      }
      const serviceCost = (await t.query(`select coalesce(sum(l.cost), 0)::bigint as v from document_lines l join items i on i.id = l.item_id where l.document_id = $1 and i.is_service`, [docId]))[0]?.v ?? 0;
      const landed = netOfTax - (doc.charges_total ?? 0) + chTotal;
      await t.query(`update documents set cost = $2 where id = $1`, [docId, landed]);
      const ap = await acc('ap');
      jl.push({ account_id: await acc('inventory'), debit: landed - serviceCost, credit: 0, memo });
      for (const ch of chList.filter((c) => c.mode === 'expense')) {
        jl.push({ account_id: await cbAccount(ch.cashbox_id), debit: 0, credit: ch.amount, memo: `${ch.name} — ${memo}` });
      }
      if (serviceCost) jl.push({ account_id: await acc('cogs'), debit: serviceCost, credit: 0, memo: `خدمات — ${memo}` });
      jl.push({ account_id: await acc('vat_input'), debit: doc.tax, credit: 0, memo });
      jl.push({ account_id: ap, party_id: doc.party_id, debit: 0, credit: doc.total, memo });
      await postPayments('out', ap, 'سداد');
      for (const x of instruments.filter((i) => i.kind === 'cheque')) {
        jl.push({ account_id: ap, party_id: doc.party_id, debit: x.amount, credit: 0, memo: `شيك ${x.cheque_no ?? ''} — ${memo}` });
        jl.push({ account_id: await acc('notes_payable'), debit: 0, credit: x.amount, memo: `شيك ${x.cheque_no ?? ''} — ${memo}` });
      }
      await createInstruments('out');
      break;
    }
    case 'purchase_return': {
      await checkReturnQty(t, doc, lines);
      let cost = 0;
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        if (item.is_service) continue;
        const c = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        await trackOut(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty }, 'return_supplier');
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, c]);
        cost += c;
      }
      await t.query(`update documents set cost = $2 where id = $1`, [docId, cost]);
      const ap = await acc('ap');
      jl.push({ account_id: ap, party_id: doc.party_id, debit: doc.total, credit: 0, memo });
      jl.push({ account_id: await acc('vat_input'), debit: 0, credit: doc.tax, memo });
      jl.push({ account_id: await acc('inventory'), debit: 0, credit: cost, memo });
      const variance = netOfTax - cost;
      if (variance > 0) jl.push({ account_id: await acc('cost_variance'), debit: 0, credit: variance, memo });
      if (variance < 0) jl.push({ account_id: await acc('cost_variance'), debit: -variance, credit: 0, memo });
      await postPayments('in', ap, 'استرداد');
      await allocate(t, doc, doc.total - doc.paid, 'purchase_invoice', doc.ref_doc_id);
      break;
    }
    case 'receipt':
    case 'payment': {
      const counter = doc.party_id ? await partyAcc() : doc.account_id;
      const isReceipt = doc.doc_type === 'receipt';
      const cash = await cbAccount(doc.cashbox_id);
      jl.push({ account_id: cash, debit: isReceipt ? doc.total : 0, credit: isReceipt ? 0 : doc.total, memo: doc.notes ?? memo });
      jl.push({ account_id: counter, party_id: doc.party_id, debit: isReceipt ? 0 : doc.total, credit: isReceipt ? doc.total : 0, memo: doc.notes ?? memo });
      const cb = await t.one(`select * from cashboxes where id = $1`, [doc.cashbox_id]);
      const fee = isReceipt ? paymentFee(cb, doc.total) : 0;
      if (fee) {
        jl.push({ account_id: await acc('payment_fees'), debit: fee, credit: 0, memo: `عمولة ${cb.name} — ${memo}` });
        jl.push({ account_id: cash, debit: 0, credit: fee, memo: `عمولة ${cb.name} — ${memo}` });
      }
      // قبض من عميل → تخصيص على فواتير البيع، صرف لمورد → على فواتير الشراء (المرتبطة أو الأقدم)
      if (party && isReceipt && party.kind === 'customer') await allocate(t, doc, doc.total, 'sale_invoice', doc.ref_doc_id);
      if (party && !isReceipt && party.kind === 'supplier') await allocate(t, doc, doc.total, 'purchase_invoice', doc.ref_doc_id);
      break;
    }
    case 'expense':
    case 'income': {
      const cash = await cbAccount(doc.cashbox_id);
      const isExp = doc.doc_type === 'expense';
      jl.push({ account_id: doc.account_id, debit: isExp ? doc.total : 0, credit: isExp ? 0 : doc.total, memo: doc.notes ?? memo });
      jl.push({ account_id: cash, debit: isExp ? 0 : doc.total, credit: isExp ? doc.total : 0, memo: doc.notes ?? memo });
      break;
    }
    case 'cash_transfer': {
      jl.push({ account_id: await cbAccount(doc.to_cashbox_id), debit: doc.total, credit: 0, memo: doc.notes ?? memo });
      jl.push({ account_id: await cbAccount(doc.cashbox_id), debit: 0, credit: doc.total, memo: doc.notes ?? memo });
      break;
    }
    case 'partner_capital':
    case 'partner_withdrawal': {
      const p = await t.one(`select * from partners where id = $1`, [doc.partner_id]);
      const cash = await cbAccount(doc.cashbox_id);
      if (doc.doc_type === 'partner_capital') {
        jl.push({ account_id: cash, debit: doc.total, credit: 0, memo: `${memo} — ${p.name}` });
        jl.push({ account_id: p.capital_account_id, debit: 0, credit: doc.total, memo: `${memo} — ${p.name}` });
      } else {
        // المسحوبات تُحمّل على الحساب الجاري للشريك وتُسوّى من نصيبه في الأرباح
        jl.push({ account_id: p.current_account_id, debit: doc.total, credit: 0, memo: `${memo} — ${p.name}` });
        jl.push({ account_id: cash, debit: 0, credit: doc.total, memo: `${memo} — ${p.name}` });
      }
      break;
    }
    case 'profit_distribution': {
      if (!hasPermission(ctx.user.permissions, 'partners.distribute')) throw new AppError('اعتماد توزيع الأرباح يحتاج صلاحية خاصة', 'forbidden');
      // الأرقام تُعاد حسابها عند الاعتماد حتى لا يُعتمد توزيع على أرقام قديمة
      const nowNet = data.profit_basis === 'cash'
        ? (await cashResult(t, { from: data.period_from, to: data.period_to })).result
        : (await incomeStatement(t, { from: data.period_from, to: data.period_to })).net_profit;
      if (nowNet !== data.net_profit) {
        throw new AppError(`تغيرت ${data.profit_basis === 'cash' ? 'النتيجة النقدية' : 'صافي ربح'} الفترة منذ إعداد المسودة (كان ${data.net_profit / 100} وأصبح ${nowNet / 100}). أعد حفظ المسودة لتحديث الأرقام`, 'state');
      }
      const distAcc = await acc('profit_distribution');
      jl.push({ account_id: distAcc, debit: doc.total, credit: 0, memo });
      for (const s of data.shares as any[]) {
        const p = await t.one(`select * from partners where id = $1`, [s.partner_id]);
        if (s.amount > 0) jl.push({ account_id: p.current_account_id, debit: 0, credit: s.amount, memo: `نصيب ${p.name} — ${memo}` });
      }
      break;
    }
    case 'stock_transfer': {
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        if (item.is_service) throw new AppError(`«${item.name}» خدمة ولا تُحوّل`);
        const value = await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, allowNegative, document_id: docId, line_id: l.id });
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.to_warehouse_id, qty: l.base_qty, value, document_id: docId, line_id: l.id });
        await trackTransfer(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty }, doc.to_warehouse_id);
        await t.query(`update document_lines set cost = $2 where id = $1`, [l.id, value]);
      }
      break;
    }
    case 'stock_adjustment': {
      let net = 0;
      for (const l of lines) {
        const item = await itemOf(l.item_id);
        if (item.is_service) continue;
        const sys = await currentQty(t, l.item_id, doc.warehouse_id);
        const diff = l.base_qty - sys;
        let value = 0;
        const tctx = { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: Math.abs(diff) };
        if (diff > 0) {
          value = mulDiv(diff, item.avg_cost || item.last_cost, 1000);
          await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: diff, value, document_id: docId, line_id: l.id });
          await trackIn(t, tctx);
        } else if (diff < 0) {
          value = -(await stockOut(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: -diff, allowNegative: true, document_id: docId, line_id: l.id }));
          await trackOut(t, tctx, 'adjust');
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
        const item = await itemOf(l.item_id);
        if (item.is_service) throw new AppError(`«${item.name}» خدمة وليس لها رصيد`);
        await stockIn(t, { date, item_id: l.item_id, warehouse_id: doc.warehouse_id, qty: l.base_qty, value: l.total, document_id: docId, line_id: l.id, setLastCost: true });
        await trackIn(t, { date, doc, line: l, item, warehouse_id: doc.warehouse_id, qty: l.base_qty });
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
      for (const l of data.journal_lines ?? []) jl.push({ ...l, memo: l.memo ?? doc.notes ?? memo });
      break;
    }
    case 'year_closing': {
      // يُقفل رصيد كل حساب إيرادات/مصروفات (منذ آخر إقفال) وتوزيعات الأرباح المعلنة في الأرباح المحتجزة
      const rows = await t.query(
        `select a.id, a.type, a.system_key, coalesce(sum(l.debit - l.credit), 0)::bigint as bal
           from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
          where (a.type in ('revenue','expense') or a.system_key = 'profit_distribution') and e.date <= $1
          group by a.id having coalesce(sum(l.debit - l.credit), 0) <> 0`,
        [date],
      );
      let net = 0; // موجب = ربح يُضاف للأرباح المحتجزة
      for (const r of rows) {
        if (r.bal > 0) jl.push({ account_id: r.id, debit: 0, credit: r.bal, memo });
        else jl.push({ account_id: r.id, debit: -r.bal, credit: 0, memo });
        net -= r.bal;
      }
      const retained = await acc('retained');
      if (net > 0) jl.push({ account_id: retained, debit: 0, credit: net, memo: `${memo} — صافي الربح` });
      if (net < 0) jl.push({ account_id: retained, debit: -net, credit: 0, memo: `${memo} — صافي الخسارة` });
      await t.query(`update documents set total = $2 where id = $1`, [docId, Math.abs(net)]);
      await t.query(`update documents set data = data || $2::jsonb where id = $1`, [docId, JSON.stringify({ net_result: net })]);
      break;
    }
  }

  await writeJournal(t, { date, document_id: docId, memo: doc.notes ? `${memo} — ${doc.notes}` : memo, lines: jl, created_by: uid });
  await t.query(`update documents set status = 'posted', posted_by = $2, posted_at = now(), review_reason = null where id = $1`, [docId, uid]);
  return t.one(`select * from documents where id = $1`, [docId]);
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
    if (!rl) throw new AppError('كل سطر في المرتجع المرتبط بفاتورة يجب أن يرتبط بسطر منها');
    if (rl.item_id !== l.item_id) throw new AppError('صنف المرتجع يختلف عن صنف الفاتورة');
    const already = retMap.get(l.ref_line_id) ?? 0;
    if (already + l.base_qty > rl.base_qty) throw new AppError('كمية المرتجع أكبر من المتبقي في الفاتورة الأصلية');
    retMap.set(l.ref_line_id, already + l.base_qty);
  }
}

/** إلغاء مستند: المسودة تُلغى مباشرة، والمرحّل يُعكس بقيد عكسي وحركات عكسية مع الاحتفاظ بالأصل */
export async function cancelDocument(t: Db, ctx: Ctx, docId: string, reason: string) {
  const doc = await t.one(`select * from documents where id = $1 for update`, [docId]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  if (doc.status === 'cancelled') throw new AppError('المستند ملغي بالفعل', 'state');
  if (doc.status === 'posted' && !DOC_TYPES[doc.doc_type as DocType].noPosting) {
    await assertPeriodOpen(t, doc.date);
    const deps = await t.one(`select count(*)::int as n from documents where ref_doc_id = $1 and status = 'posted'`, [docId]);
    if (deps && deps.n > 0) throw new AppError('لا يمكن الإلغاء: توجد مستندات مرحّلة مرتبطة به (مرتجعات أو سندات). ألغها أولًا', 'state');
    const alloc = await t.one(`select count(*)::int as n from allocations where invoice_id = $1 and not reversed`, [docId]);
    if (alloc && alloc.n > 0) throw new AppError('لا يمكن الإلغاء: توجد مقبوضات/مدفوعات مخصصة على هذه الفاتورة. ألغها أولًا', 'state');
    const dlv = await t.one(`select count(*)::int as n from deliveries where document_id = $1`, [docId]);
    if (dlv && dlv.n > 0) throw new AppError('لا يمكن الإلغاء: تم تسليم جزء من الفاتورة. استخدم مرتجع بيع للكميات المسلّمة', 'state');
    const inst = await t.one(`select count(*)::int as n from instruments where document_id = $1 and status not in ('open','cancelled')`, [docId]);
    if (inst && inst.n > 0) throw new AppError('لا يمكن الإلغاء: تم تحصيل أو إغلاق شيكات/أقساط هذه الفاتورة', 'state');
    if (doc.doc_type === 'profit_distribution') {
      const later = await t.one(`select 1 from documents where doc_type = 'partner_withdrawal' and status = 'posted' and date >= $1 limit 1`, [doc.date]);
      if (later) {
        // لا نمنع، لكن نسجل في السبب للتدقيق
        reason = `${reason} (توجد مسحوبات شركاء بعد التوزيع)`;
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const date = doc.date > today ? doc.date : today;
    await reverseTracking(t, docId);
    await reverseStockMoves(t, docId, date);
    await reverseDocumentJournals(t, docId, date, ctx.user.id, `إلغاء ${DOC_TYPES[doc.doc_type as DocType].label} ${doc.number}: ${reason}`);
    await reverseAllocations(t, docId);
    await t.query(`update instruments set status = 'cancelled' where document_id = $1 and status = 'open'`, [docId]);
    if (doc.doc_type === 'sale_invoice' && doc.data?.from_quotation_id) await t.query(`update documents set converted_to_id = null where id = $1`, [doc.data.from_quotation_id]);
  }
  await t.query(`update documents set status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now() where id = $1`, [docId, reason, ctx.user.id]);
  return t.one(`select * from documents where id = $1`, [docId]);
}

/** إنشاء وترحيل مستند داخلي (تحصيل شيك/قسط، فرق وردية) */
export async function createAndPost(t: Db, ctx: Ctx, doc: Partial<DocInput> & { doc_type: DocType; date: string }) {
  const full: DocInput = {
    id: (doc as any).id ?? crypto.randomUUID(),
    lines: [],
    journal_lines: [],
    payments: [],
    instruments: [],
    paid: 0,
    amount: 0,
    discount: 0,
    reserve: false,
    retained_bp: 0,
    ...doc,
  } as DocInput;
  await saveDocument(t, ctx, full);
  return postDocument(t, ctx, full.id);
}
