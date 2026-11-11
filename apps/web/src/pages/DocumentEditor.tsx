import {
  computeDocument, DOC_TYPES, formatMoney, formatQty, hasPermission, mulDiv, todayISO, toBaseQty, uuid, type DocInput, type DocType,
} from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, Plus, ScanLine, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Field, MoneyInput, Picker, QtyInput, Segmented, Sheet, Switch, useUi, type PickOption } from '../components/ui';
import { localAvailable, priceFor, saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession, useSettings } from '../lib/hooks';
import { ItemEditor } from './Items';
import { PartyEditor } from './Parties';

interface Line {
  id: string;
  item_id: string;
  unit_name: string;
  unit_factor: number;
  qty: number;
  price: number;
  discount: number;
  tax_rate_bp: number;
  ref_line_id?: string | null;
  max_qty?: number;
  serials: string[];
  expiry?: string | null;
}
interface Pay {
  id: string;
  cashbox_id: string;
  amount: number;
}
interface Charge {
  id: string;
  name: string;
  mode: 'add' | 'expense';
  amount: number;
  cashbox_id?: string | null;
}
interface Inst {
  id: string;
  kind: 'cheque' | 'installment';
  amount: number;
  due_date: string;
  cheque_no?: string | null;
  bank?: string | null;
}

const EFFECT: Partial<Record<DocType, string>> = {
  sale_invoice: 'سيُخصم المخزون ويُسجل قيد المبيعات والتكلفة وتُحدّث الخزائن وحساب العميل والشيكات والأقساط.',
  sale_return: 'ستُعاد الكميات للمخزن ويُسجل قيد المرتجع ويُخفض حساب العميل (أو تُرد النقدية).',
  purchase_invoice: 'ستُضاف الكميات للمخزن بالتكلفة ويُحدّث متوسط التكلفة وحساب المورد والخزائن.',
  purchase_return: 'ستُخصم الكميات من المخزن ويُخفض حساب المورد.',
  receipt: 'سيُضاف المبلغ للخزينة ويُخفض رصيد الطرف ويُخصص على أقدم فواتيره المفتوحة (أو الفاتورة المحددة).',
  payment: 'سيُخصم المبلغ من الخزينة ويُخفض المستحق للطرف ويُخصص على فواتيره المفتوحة.',
  expense: 'سيُخصم المبلغ من الخزينة ويُسجل على حساب المصروف.',
  income: 'سيُضاف المبلغ للخزينة ويُسجل على حساب الإيراد.',
  stock_transfer: 'ستُنقل الكميات وتكلفتها من المخزن الأول للثاني.',
  stock_adjustment: 'ستُعدّل أرصدة المخزن لتساوي الكميات الفعلية ويُسجل فرق الجرد في الحسابات.',
  opening_stock: 'ستُضاف الكميات كبضاعة أول المدة ويُسجل قيد الأرصدة الافتتاحية.',
  party_opening: 'سيُسجل الرصيد الافتتاحي في حساب الطرف مقابل حساب الأرصدة الافتتاحية.',
  journal_voucher: 'سيُرحّل القيد على الحسابات المحددة.',
  cash_transfer: 'سيُنقل المبلغ من الخزينة الأولى للثانية.',
  quotation: 'سيُعتمد عرض الأسعار. إذا كان «حجز البضاعة» مفعلًا تُحجز الكميات حتى تحويله لفاتورة أو إلغائه.',
  partner_capital: 'سيُضاف المبلغ للخزينة ولحساب رأس مال الشريك.',
  partner_withdrawal: 'سيُخصم المبلغ من الخزينة ويُحمّل على الحساب الجاري للشريك (يُسوّى من نصيبه في الأرباح).',
};

const IN_DOCS: DocType[] = ['purchase_invoice', 'opening_stock', 'sale_return', 'stock_adjustment'];

export function DocumentEditor() {
  const params = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ui = useUi();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const settings = useSettings();

  const existing = useLiveQuery(async () => (params.id ? ((await db.documents.get(params.id)) ?? null) : null), [params.id]);
  const existingLines = useLiveQuery(async () => (params.id ? db.document_lines.where('document_id').equals(params.id).sortBy('line_no') : []), [params.id]);
  const type = (params.type ?? existing?.doc_type) as DocType;
  const info = DOC_TYPES[type];

  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];
  const units = useLiveQuery(() => db.item_units.toArray(), []) ?? [];
  const parties = useLiveQuery(() => db.parties.toArray(), []) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false && (!session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id))), []) ?? [];
  const allWarehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const cashboxes = useLiveQuery(async () => (await db.cashboxes.toArray()).filter((c) => c.active !== false && (!session.user.cashbox_ids || session.user.cashbox_ids.includes(c.id))), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];
  const priceLists = useLiveQuery(async () => (await db.price_lists.orderBy('sort').toArray()).filter((p) => p.active !== false), []) ?? [];
  const reps = useLiveQuery(async () => (await db.sales_reps.toArray()).filter((r) => r.active !== false), []) ?? [];
  const partners = useLiveQuery(async () => (await db.partners.toArray()).filter((p) => p.active !== false), []) ?? [];
  const myShift = useLiveQuery(async () => (await db.cashier_shifts.where('user_id').equals(session.user.id).toArray()).find((s) => s.status === 'open') ?? null, []);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const isSale = type === 'sale_invoice' || type === 'sale_return' || type === 'quotation';
  const isPurchase = type?.startsWith('purchase');
  const isInvoice = type === 'sale_invoice' || type === 'purchase_invoice';
  const hasPayments = !!info?.priced && !info.noPosting;

  const [ready, setReady] = useState(false);
  const [h, setH] = useState<any>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [jl, setJl] = useState<any[]>([]);
  const [payments, setPayments] = useState<Pay[]>([]);
  const [insts, setInsts] = useState<Inst[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payAuto, setPayAuto] = useState(true);
  const [counterMode, setCounterMode] = useState<'party' | 'account'>('party');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [newItem, setNewItem] = useState(false);
  const [newParty, setNewParty] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scan, setScan] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  // ---------------- التحميل
  useEffect(() => {
    if (ready || !info) return;
    if (params.id) {
      if (existing === undefined || existingLines === undefined || !existing) return;
      setH({ ...existing, from_quotation_id: existing.data?.from_quotation_id ?? null });
      setLines(existingLines.map((l: any) => ({ ...l, serials: l.serials ?? [] })));
      setJl(existing.data?.journal_lines ?? []);
      setPayments(existing.data?.payments ?? []);
      setInsts(existing.data?.instruments ?? []);
      setCharges(existing.data?.charges ?? []);
      setPayAuto(false);
      setCounterMode(existing.account_id && !existing.party_id ? 'account' : 'party');
      setReady(true);
      return;
    }
    if (!warehouses.length || !cashboxes.length) return;
    const party = sp.get('party');
    const partyRow = parties.find((p) => p.id === party);
    setH({
      date: todayISO(),
      warehouse_id: warehouses[0]?.id,
      to_warehouse_id: '',
      cashbox_id: myShift?.cashbox_id ?? cashboxes[0]?.id,
      to_cashbox_id: '',
      party_id: party ?? (type === 'sale_invoice' || type === 'quotation' ? 'party-cash-customer' : null),
      price_list_id: partyRow?.price_list_id ?? 'pl-retail',
      sales_rep_id: null,
      partner_id: sp.get('partner'),
      amount: 0,
      discount: 0,
      side: type === 'party_opening' ? 'debit' : null,
      ref_doc_id: sp.get('ref'),
      reserve: false,
      due_date: null,
      deliver_later: false,
      shipping_company: '',
      order_status: '',
      notes: '',
    });
    setJl([
      { account_id: '', party_id: null, debit: 0, credit: 0, memo: '' },
      { account_id: '', party_id: null, debit: 0, credit: 0, memo: '' },
    ]);
    setPayAuto(type === 'sale_invoice' || type === 'sale_return' ? true : false);
    setReady(true);
  }, [ready, info, params.id, existing, existingLines, warehouses, cashboxes, sp, type, parties, myShift]);

  // تحويل عرض أسعار لفاتورة
  useEffect(() => {
    const qid = sp.get('quotation');
    if (!ready || params.id || !qid || h.from_quotation_id) return;
    (async () => {
      const q = await db.documents.get(qid);
      if (!q) return;
      const ql = await db.document_lines.where('document_id').equals(qid).sortBy('line_no');
      setH((p: any) => ({ ...p, party_id: q.party_id, warehouse_id: q.warehouse_id, price_list_id: q.price_list_id, sales_rep_id: q.sales_rep_id, discount: q.discount, from_quotation_id: qid, notes: `من عرض أسعار ${q.number ?? q.local_number}` }));
      setLines(ql.map((l: any) => ({ id: uuid(), item_id: l.item_id, unit_name: l.unit_name, unit_factor: l.unit_factor, qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp, serials: [] })));
    })();
  }, [ready, sp, params.id, h.from_quotation_id]);

  const set = (k: string, v: unknown) => setH((p: any) => ({ ...p, [k]: v }));
  const party = parties.find((p) => p.id === h.party_id);

  // ---------------- المرتجع من فاتورة
  const refDocs = useLiveQuery(async () => {
    if (!info?.refType || !h.party_id) return [];
    return (await db.documents.where('party_id').equals(h.party_id).toArray())
      .filter((d) => d.doc_type === info.refType && d.status === 'posted' && !d._sync)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [info?.refType, h.party_id]) ?? [];

  const loadRef = useCallback(
    async (refId: string | null) => {
      set('ref_doc_id', refId);
      if (!refId) {
        setLines([]);
        return;
      }
      const ref = await db.documents.get(refId);
      const refLines = await db.document_lines.where('document_id').equals(refId).sortBy('line_no');
      const prior = (await db.documents.where('ref_doc_id').equals(refId).toArray()).filter((d) => d.status === 'posted' && d.id !== params.id && d.doc_type === type);
      const returned = new Map<string, number>();
      for (const p of prior) for (const l of await db.document_lines.where('document_id').equals(p.id).toArray()) returned.set(l.ref_line_id, (returned.get(l.ref_line_id) ?? 0) + l.base_qty);
      setLines(
        refLines
          .map((l) => {
            const remainingBase = l.base_qty - (returned.get(l.id) ?? 0);
            const maxQty = mulDiv(remainingBase, 1000, l.unit_factor);
            const netUnitPrice = l.qty ? mulDiv(l.total - l.tax, 1000, l.qty) : l.price;
            return { id: uuid(), item_id: l.item_id, unit_name: l.unit_name, unit_factor: l.unit_factor, qty: maxQty, price: netUnitPrice, discount: 0, tax_rate_bp: l.tax_rate_bp, ref_line_id: l.id, max_qty: maxQty, serials: [] as string[] };
          })
          .filter((l) => l.max_qty > 0),
      );
      if (ref?.warehouse_id) set('warehouse_id', ref.warehouse_id);
    },
    [params.id, type],
  );
  useEffect(() => {
    if (ready && !params.id && h.ref_doc_id && lines.length === 0) void loadRef(h.ref_doc_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ---------------- السطور
  const unitOptions = (itemId: string) => {
    const it = itemMap.get(itemId);
    if (!it) return [] as any[];
    return [{ name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price }, ...units.filter((u) => u.item_id === itemId && u.active !== false)] as any[];
  };
  const defaultPrice = async (itemId: string, unit: any, pl: string | null = h.price_list_id) => {
    const it = itemMap.get(itemId);
    if (!it) return 0;
    if (isSale) return priceFor(it, unit, pl);
    if (isPurchase || type === 'opening_stock') return mulDiv(it.last_cost || it.avg_cost || 0, unit.factor, 1000);
    return 0;
  };
  const addItem = async (itemId: string, unitName?: string) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    const u = unitOptions(itemId).find((x) => x.name === (unitName ?? it.base_unit))!;
    const price = await defaultPrice(itemId, u);
    const partyDisc = isSale && party?.discount_bp ? Math.round((price * party.discount_bp) / 10000) : 0;
    setLines((ls) => {
      const same = ls.find((l) => l.item_id === itemId && l.unit_name === u.name && !l.ref_line_id && !it.track_serial);
      if (same && type !== 'stock_adjustment') return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1000, discount: l.discount + partyDisc } : l));
      return [...ls, { id: uuid(), item_id: itemId, unit_name: u.name, unit_factor: u.factor, qty: type === 'stock_adjustment' ? 0 : 1000, price, discount: partyDisc, tax_rate_bp: info.priced ? it.tax_rate_bp ?? 0 : 0, serials: [] }];
    });
  };
  const updLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const repriceAll = async (pl: string) => {
    const next = [];
    for (const l of lines) {
      if (l.ref_line_id) {
        next.push(l);
        continue;
      }
      const u = unitOptions(l.item_id).find((x) => x.name === l.unit_name);
      next.push({ ...l, price: u ? await defaultPrice(l.item_id, u, pl) : l.price });
    }
    setLines(next);
  };

  const onScan = async () => {
    const code = scan.trim();
    if (!code) return;
    const unit = await db.item_units.where('barcode').equals(code).first();
    if (unit) {
      await addItem(unit.item_id, unit.name);
      setScan('');
      return;
    }
    const it = (await db.items.where('barcode').equals(code).first()) ?? (await db.items.where('code').equals(code).first());
    if (it) {
      await addItem(it.id);
      setScan('');
    } else ui.toast(`لا يوجد صنف بالكود/الباركود ${code}`, 'err');
  };

  useEffect(() => {
    if (!info?.stock || !h.warehouse_id) return;
    let alive = true;
    (async () => {
      const r: Record<string, number> = {};
      for (const id of new Set(lines.map((l) => l.item_id).filter(Boolean))) r[id] = await localAvailable(id, h.warehouse_id, params.id);
      if (alive) setAvail(r);
    })();
    return () => {
      alive = false;
    };
  }, [lines, h.warehouse_id, info?.stock, params.id]);

  // ---------------- الحساب
  const calc = useMemo(() => {
    if (!info || (!info.priced && type !== 'opening_stock')) return null;
    try {
      return computeDocument(
        lines.map((l) => ({ qty: Math.max(l.qty, 0), price: l.price, discount: info.priced ? l.discount : 0, tax_rate_bp: info.priced ? l.tax_rate_bp : 0 })),
        info.priced ? h.discount ?? 0 : 0,
      );
    } catch (e) {
      return { error: (e as Error).message } as any;
    }
  }, [lines, h.discount, info, type]);
  const chargesAdd = isInvoice ? charges.filter((c) => c.mode === 'add').reduce((s, c) => s + c.amount, 0) : 0;
  const total = calc && !calc.error ? calc.total + chargesAdd : 0;

  // السداد التلقائي: سطر واحد بكامل المبلغ في الخزينة الافتراضية حتى يعدّل المستخدم
  useEffect(() => {
    if (!hasPayments || !payAuto || !ready) return;
    const instTotal = insts.reduce((s, x) => s + x.amount, 0);
    const want = h.party_id === 'party-cash-customer' || type === 'sale_invoice' ? total - instTotal : 0;
    setPayments(want > 0 && h.cashbox_id ? [{ id: payments[0]?.id ?? uuid(), cashbox_id: h.cashbox_id, amount: want }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, payAuto, hasPayments, ready, h.cashbox_id, h.party_id, insts]);

  const cashPaid = payments.reduce((s, p) => s + p.amount, 0);
  const instTotal = insts.reduce((s, x) => s + x.amount, 0);
  const credit = total - cashPaid - instTotal;

  const shortages = useMemo(() => {
    if (!info || !(info.stock === 'out' || info.stock === 'transfer')) return [];
    const need = new Map<string, number>();
    lines.forEach((l) => {
      if (!l.item_id || itemMap.get(l.item_id)?.is_service) return;
      need.set(l.item_id, (need.get(l.item_id) ?? 0) + toBaseQty(Math.max(l.qty, 0), l.unit_factor));
    });
    return [...need.entries()].filter(([id, q]) => q > (avail[id] ?? 0)).map(([id, q]) => ({ item: itemMap.get(id), need: q, have: avail[id] ?? 0 }));
  }, [lines, avail, info, itemMap]);

  const jlTotals = useMemo(() => ({ dr: jl.reduce((s, l) => s + (l.debit || 0), 0), cr: jl.reduce((s, l) => s + (l.credit || 0), 0) }), [jl]);

  // ---------------- خيارات
  const partyOptions: PickOption[] = useMemo(
    () =>
      parties
        .filter((p) => p.active !== false && (info?.partyKind === 'any' || !info?.partyKind || p.kind === info.partyKind || type === 'party_opening'))
        .map((p) => ({ id: p.id, label: p.name, sub: `${p.kind === 'customer' ? 'عميل' : 'مورد'} · ${p.code}`, search: `${p.name} ${p.code} ${p.phone ?? ''}` })),
    [parties, info, type],
  );
  const itemOptions: PickOption[] = useMemo(
    () => items.filter((i) => i.active !== false).map((i) => ({ id: i.id, label: i.name, sub: i.code, search: `${i.name} ${i.code} ${i.barcode ?? ''}` })),
    [items],
  );
  const leafAccounts = (filter?: (a: any) => boolean): PickOption[] =>
    accounts.filter((a) => !a.is_group && a.active !== false && (!filter || filter(a))).map((a) => ({ id: a.id, label: a.name, sub: a.code, search: `${a.code} ${a.name}` }));

  // ---------------- الحفظ
  const buildDoc = (): DocInput => {
    const isCashDoc = ['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'partner_capital', 'partner_withdrawal'].includes(type);
    const pays = hasPayments ? payments.filter((p) => p.amount > 0) : [];
    return {
      id: params.id ?? uuid(),
      doc_type: type,
      date: h.date,
      party_id: counterMode === 'account' && (type === 'receipt' || type === 'payment') ? null : h.party_id || null,
      warehouse_id: info.stock || type === 'quotation' ? h.warehouse_id : null,
      to_warehouse_id: info.stock === 'transfer' ? h.to_warehouse_id || null : null,
      cashbox_id: isCashDoc ? h.cashbox_id : pays[0]?.cashbox_id ?? null,
      to_cashbox_id: type === 'cash_transfer' ? h.to_cashbox_id || null : null,
      account_id: ['expense', 'income'].includes(type) || (counterMode === 'account' && ['receipt', 'payment'].includes(type)) ? h.account_id || null : null,
      partner_id: type === 'partner_capital' || type === 'partner_withdrawal' ? h.partner_id || null : null,
      sales_rep_id: isSale ? h.sales_rep_id || null : null,
      price_list_id: isSale ? h.price_list_id || null : null,
      shift_id: myShift && !myShift._sync && (pays.some((p) => p.cashbox_id === myShift.cashbox_id) || (isCashDoc && h.cashbox_id === myShift.cashbox_id)) ? myShift.id : null,
      due_date: isInvoice && credit > 0 ? h.due_date || null : null,
      reserve: type === 'quotation' ? !!h.reserve : false,
      deliver_later: type === 'sale_invoice' ? !!h.deliver_later : false,
      order_status: type === 'sale_invoice' ? h.order_status || null : null,
      shipping_company: type === 'sale_invoice' ? h.shipping_company || null : null,
      charges: isInvoice ? charges.filter((c) => c.amount > 0 && c.name.trim()) : [],
      from_quotation_id: type === 'sale_invoice' ? h.from_quotation_id || null : null,
      payment_type: info.priced && !info.noPosting ? (credit > 0 || instTotal > 0 ? 'credit' : 'cash') : null,
      payments: pays,
      instruments: isInvoice ? insts : [],
      paid: 0,
      amount: h.amount ?? 0,
      discount: info.priced ? h.discount ?? 0 : 0,
      ref_doc_id: h.ref_doc_id || null,
      side: type === 'party_opening' ? h.side : null,
      notes: h.notes || null,
      local_number: h.local_number ?? null,
      retained_bp: 0,
      lines: lines
        .filter((l) => l.item_id)
        .map((l) => ({
          id: l.id, item_id: l.item_id, unit_name: l.unit_name, unit_factor: l.unit_factor, qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp,
          ref_line_id: l.ref_line_id ?? null, notes: null, serials: l.serials ?? [], expiry: l.expiry || null,
        })),
      journal_lines: type === 'journal_voucher' ? jl.filter((l) => l.account_id && (l.debit || l.credit)).map((l) => ({ account_id: l.account_id, party_id: l.party_id || null, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || null })) : [],
    };
  };

  const validate = (d: DocInput): string | null => {
    if (!d.date) return 'التاريخ مطلوب';
    if (info.hasLines && d.lines.length === 0) return 'أضف صنفًا واحدًا على الأقل';
    if (info.stock === 'transfer' && (!d.to_warehouse_id || d.to_warehouse_id === d.warehouse_id)) return 'اختر مخزنًا مختلفًا للتحويل إليه';
    if (info.stock !== 'adjust' && d.lines.some((l) => l.qty <= 0)) return 'كل الكميات يجب أن تكون أكبر من صفر';
    if (lines.some((l) => l.max_qty !== undefined && l.qty > l.max_qty)) return 'كمية المرتجع أكبر من المتبقي في الفاتورة';
    if (info.refType && !d.ref_doc_id && !can(`${info.module}.free_return`)) return 'اختر الفاتورة الأصلية للمرتجع';
    if (calc?.error) return calc.error;
    for (const l of lines) {
      const it = itemMap.get(l.item_id);
      if (!it) continue;
      if (it.track_serial && info.stock && info.stock !== 'adjust' && !(type === 'sale_invoice' && h.deliver_later)) {
        const n = l.qty / 1000;
        if (l.serials.length !== n) return `أدخل ${n} رقم سيريال للصنف «${it.name}» (المُدخل ${l.serials.length})`;
      }
      if (it.track_expiry && IN_DOCS.includes(type) && !l.expiry && !it.expiry_default_days && type !== 'stock_adjustment') return `أدخل تاريخ الصلاحية للصنف «${it.name}»`;
    }
    if (hasPayments) {
      if (cashPaid + instTotal > total) return 'المدفوع والشيكات والأقساط أكبر من الإجمالي';
      if (d.party_id === 'party-cash-customer' && cashPaid < total) return 'العميل النقدي يسدد كامل الفاتورة؛ اختر عميلًا مسجلًا للآجل';
      if (!d.party_id && isPurchase) return 'اختر المورد';
      if (payments.some((p) => !p.cashbox_id)) return 'اختر الخزينة لكل سطر سداد';
      if (insts.some((x) => !x.due_date || x.amount <= 0)) return 'أكمل بيانات الشيكات والأقساط';
      if (charges.some((c) => c.amount > 0 && (!c.name.trim() || (c.mode === 'expense' && !c.cashbox_id)))) return 'أكمل بيانات الإضافات والمصروفات (الاسم والخزينة)';
    }
    if (['receipt', 'payment'].includes(type) && !d.party_id && !d.account_id) return 'اختر الطرف أو الحساب';
    if (['expense', 'income'].includes(type) && !d.account_id) return 'اختر الحساب';
    if (type === 'cash_transfer' && (!d.to_cashbox_id || d.to_cashbox_id === d.cashbox_id)) return 'اختر خزينة مختلفة للتحويل إليها';
    if ((type === 'partner_capital' || type === 'partner_withdrawal') && !d.partner_id) return 'اختر الشريك';
    if (!info.hasLines && type !== 'journal_voucher' && d.amount <= 0) return 'أدخل المبلغ';
    if (type === 'party_opening' && !d.party_id) return 'اختر الطرف';
    if (type === 'stock_adjustment' && !d.notes?.trim()) return 'اكتب سبب الجرد/التسوية في الملاحظات';
    if (type === 'journal_voucher') {
      if (d.journal_lines.length < 2) return 'القيد يحتاج سطرين على الأقل';
      if (jlTotals.dr !== jlTotals.cr) return 'القيد غير متوازن';
      for (const l of d.journal_lines) {
        const acc = accounts.find((a) => a.id === l.account_id);
        if ((acc?.system_key === 'ar' || acc?.system_key === 'ap') && !l.party_id) return `حدد الطرف في سطر حساب ${acc.name}`;
      }
    }
    return null;
  };

  const submit = async (action: 'draft' | 'post') => {
    setError(null);
    const d = buildDoc();
    const v = validate(d);
    if (v) return setError(v);
    if (action === 'post') {
      const extra = shortages.length ? `\n\nتنبيه: الرصيد المتاح على هذا الجهاز أقل من المطلوب لـ ${shortages.map((s) => s.item?.name).join('، ')}. إذا لم يكفِ الرصيد مركزيًا سيُحفظ المستند بحالة «يحتاج مراجعة».` : '';
      const ok = await ui.confirm({
        title: `${info.noPosting ? 'اعتماد' : 'ترحيل'} ${info.label}؟`,
        message: (EFFECT[type] ?? '') + extra + (info.noPosting ? '' : '\nبعد الترحيل لا يمكن التعديل، ويتم التصحيح بالإلغاء أو بمستند عكسي.'),
        confirmLabel: info.noPosting ? 'اعتماد' : 'ترحيل',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await saveDocument(d, action, existing ?? null);
      ui.toast(action === 'post' ? 'تم الحفظ وسيُرحّل عند المزامنة' : 'تم حفظ المسودة');
      nav(`/docs/view/${d.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit('post');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void submit('draft');
      } else if (e.key === 'F2') {
        e.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!info) return <div className="page"><Banner kind="err">نوع مستند غير معروف</Banner></div>;
  if (type === 'profit_distribution') return <div className="page"><Banner kind="info">توزيع الأرباح يتم من شاشة الشركاء.</Banner></div>;
  if (params.id && existing && existing.status !== 'draft' && existing.status !== 'pending_review' && existing._sync !== 'rejected')
    return <div className="page"><Banner kind="warn">هذا المستند {existing.status === 'posted' ? 'مُرحّل' : 'ملغي'} ولا يمكن تعديله.</Banner></div>;
  if (!ready) return <div className="page muted">جارٍ التحميل…</div>;

  const priceLocked = isSale && type !== 'sale_return' && !can('sales.price_change');
  const discountLocked = isSale && type !== 'sale_return' && !can('sales.discount');
  const showCost = can('costs.view');
  const freeReturn = !!info.refType && !h.ref_doc_id;
  const showLineAdd = !info.refType || freeReturn;

  return (
    <div className="page">
      <PageHeader
        title={`${params.id ? 'تعديل ' : ''}${info.label}`}
        sub={existing ? <span className="num">{existing.number ?? existing.local_number}</span> : h.from_quotation_id ? 'تحويل عرض أسعار إلى فاتورة' : 'مستند جديد'}
        actions={
          <>
            <button className="btn" disabled={busy} onClick={() => submit('draft')} title="Ctrl+S">حفظ مسودة</button>
            <button className="btn primary" disabled={busy} onClick={() => submit('post')} title="Ctrl+Enter">{info.noPosting ? 'اعتماد' : 'ترحيل'}</button>
          </>
        }
      />
      {myShift && hasPayments && <div style={{ marginBottom: 12 }}><Banner kind="info">وردية مفتوحة على {cashboxes.find((c) => c.id === myShift.cashbox_id)?.name}: النقدية المحصلة فيها تُحسب على الوردية.</Banner></div>}
      {existing?._error && <div style={{ marginBottom: 12 }}><Banner kind="err">{existing._error}</Banner></div>}
      {existing?.review_reason && <div style={{ marginBottom: 12 }}><Banner kind="warn">{existing.review_reason}</Banner></div>}
      {error && <div style={{ marginBottom: 12 }}><Banner kind="err">{error}</Banner></div>}

      {/* ---------- الرأس ---------- */}
      <div className="card pad">
        <div className="grid grid-4">
          <Field label="التاريخ">
            <input type="date" className="input" value={h.date} onChange={(e) => set('date', e.target.value)} />
          </Field>

          {(info.partyKind || type === 'party_opening') && ((type !== 'receipt' && type !== 'payment') || counterMode === 'party') && (
            <Field label={info.partyKind === 'supplier' ? 'المورد' : info.partyKind === 'customer' ? 'العميل' : 'الطرف'}>
              <div className="row" style={{ gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <Picker
                    value={h.party_id}
                    options={partyOptions}
                    onChange={(v) => {
                      const p = parties.find((x) => x.id === v);
                      setH((o: any) => ({ ...o, party_id: v, price_list_id: isSale ? p?.price_list_id ?? o.price_list_id : o.price_list_id }));
                      if (isSale && p?.price_list_id && p.price_list_id !== h.price_list_id) void repriceAll(p.price_list_id);
                      if (info.refType) {
                        set('ref_doc_id', null);
                        setLines([]);
                      }
                    }}
                    placeholder="ابحث بالاسم أو الكود"
                  />
                </div>
                {info.partyKind !== 'any' && can('parties.create') && (
                  <button type="button" className="icon-btn" title="إضافة جديد" onClick={() => setNewParty(true)}><UserPlus /></button>
                )}
              </div>
            </Field>
          )}

          {(type === 'receipt' || type === 'payment') && (
            <Field label="الطرف المقابل">
              <Segmented block value={counterMode} onChange={setCounterMode} options={[{ value: 'party', label: 'عميل/مورد' }, { value: 'account', label: 'حساب' }]} />
            </Field>
          )}
          {(type === 'receipt' || type === 'payment') && counterMode === 'account' && (
            <Field label="الحساب">
              <Picker value={h.account_id} options={leafAccounts((a) => !a.system_key || !['ar', 'ap'].includes(a.system_key))} onChange={(v) => set('account_id', v)} />
            </Field>
          )}
          {(type === 'expense' || type === 'income') && (
            <Field label={type === 'expense' ? 'بند المصروف' : 'بند الإيراد'}>
              <Picker value={h.account_id} options={leafAccounts((a) => a.type === (type === 'expense' ? 'expense' : 'revenue') && !['cogs', 'inventory_diff', 'cost_variance', 'sales', 'sales_returns', 'sales_discount', 'cash_over_short'].includes(a.system_key))} onChange={(v) => set('account_id', v)} />
            </Field>
          )}
          {(type === 'partner_capital' || type === 'partner_withdrawal') && (
            <Field label="الشريك">
              <select className="select" value={h.partner_id ?? ''} onChange={(e) => set('partner_id', e.target.value)}>
                <option value="">اختر…</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {(info.stock || type === 'quotation') && (
            <Field label={info.stock === 'transfer' ? 'من مخزن' : 'المخزن'}>
              <select className="select" value={h.warehouse_id ?? ''} onChange={(e) => set('warehouse_id', e.target.value)} disabled={!!h.ref_doc_id}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          )}
          {info.stock === 'transfer' && (
            <Field label="إلى مخزن">
              <select className="select" value={h.to_warehouse_id ?? ''} onChange={(e) => set('to_warehouse_id', e.target.value)}>
                <option value="">اختر…</option>
                {allWarehouses.filter((w) => w.id !== h.warehouse_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          )}

          {info.refType && (
            <Field label={can(`${info.module}.free_return`) ? 'الفاتورة الأصلية (اختياري)' : 'الفاتورة الأصلية'}>
              <select className="select" value={h.ref_doc_id ?? ''} onChange={(e) => loadRef(e.target.value || null)} disabled={!h.party_id}>
                <option value="">{!h.party_id ? 'اختر الطرف أولًا' : can(`${info.module}.free_return`) ? 'مرتجع بدون فاتورة' : 'اختر الفاتورة…'}</option>
                {refDocs.map((d) => <option key={d.id} value={d.id}>{d.number} — {d.date} — {formatMoney(d.total)}</option>)}
              </select>
            </Field>
          )}

          {isSale && type !== 'sale_return' && priceLists.length > 0 && (
            <Field label="قائمة الأسعار">
              <select className="select" value={h.price_list_id ?? ''} disabled={priceLocked && !!party?.price_list_id} onChange={(e) => { set('price_list_id', e.target.value); void repriceAll(e.target.value); }}>
                {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {isSale && reps.length > 0 && (
            <Field label="مندوب المبيعات">
              <select className="select" value={h.sales_rep_id ?? ''} onChange={(e) => set('sales_rep_id', e.target.value || null)}>
                <option value="">—</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          )}
          {type === 'sale_invoice' && can('sales.deliver') && (
            <Field label="التسليم">
              <div className="row" style={{ height: 42 }}><Switch checked={!!h.deliver_later} onChange={(v) => set('deliver_later', v)} /> {h.deliver_later ? 'لاحقًا (على مراحل)' : 'فوري'}</div>
            </Field>
          )}
          {type === 'sale_invoice' && h.deliver_later && (
            <Field label="شركة الشحن">
              <input className="input" value={h.shipping_company ?? ''} onChange={(e) => set('shipping_company', e.target.value)} />
            </Field>
          )}
          {type === 'quotation' && (
            <Field label="حجز البضاعة">
              <div className="row" style={{ height: 42 }}><Switch checked={!!h.reserve} onChange={(v) => set('reserve', v)} /> {h.reserve ? 'تُحجز الكميات' : 'بدون حجز'}</div>
            </Field>
          )}

          {(['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'partner_capital', 'partner_withdrawal'].includes(type) || (hasPayments && payAuto)) && (
            <Field label={type === 'cash_transfer' ? 'من خزينة' : 'الخزينة'}>
              <select className="select" value={h.cashbox_id ?? ''} onChange={(e) => set('cashbox_id', e.target.value)}>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {type === 'cash_transfer' && (
            <Field label="إلى خزينة">
              <select className="select" value={h.to_cashbox_id ?? ''} onChange={(e) => set('to_cashbox_id', e.target.value)}>
                <option value="">اختر…</option>
                {cashboxes.filter((c) => c.id !== h.cashbox_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {type === 'party_opening' && (
            <Field label="طبيعة الرصيد">
              <Segmented block value={h.side} onChange={(v) => set('side', v)} options={[{ value: 'debit', label: party?.kind === 'supplier' ? 'مدين (علينا له ↓)' : 'عليه لنا' }, { value: 'credit', label: party?.kind === 'supplier' ? 'له عندنا' : 'دائن (له عندنا)' }]} />
            </Field>
          )}
          {!info.hasLines && type !== 'journal_voucher' && (
            <Field label="المبلغ">
              <MoneyInput value={h.amount} onChange={(v) => set('amount', v)} autoFocus />
            </Field>
          )}
          {(type === 'receipt' || type === 'payment') && counterMode === 'party' && h.party_id && (
            <InvoiceLink type={type} partyId={h.party_id} value={h.ref_doc_id} onChange={(v, rem) => { set('ref_doc_id', v); if (v && rem) set('amount', rem); }} />
          )}
        </div>
        {party && party.kind === 'customer' && party.id !== 'party-cash-customer' && (isSale || type === 'receipt') && (
          <div className="footnote" style={{ marginTop: 10 }}>
            رصيد العميل الحالي: <span className="num bold">{formatMoney(party.balance ?? 0)}</span>
            {party.credit_limit ? <> · الحد الائتماني <span className="num">{formatMoney(party.credit_limit)}</span></> : null}
            {party.discount_bp ? <> · خصم العميل {party.discount_bp / 100}%</> : null}
          </div>
        )}
        {(type === 'receipt' || type === 'payment') && counterMode === 'party' && !h.ref_doc_id && (
          <div className="footnote" style={{ marginTop: 6 }}>بدون ربط بفاتورة: يُخصص المبلغ تلقائيًا على أقدم الفواتير المفتوحة للطرف.</div>
        )}
      </div>

      {/* ---------- السطور ---------- */}
      {info.hasLines && (
        <>
          <div className="row wrap" style={{ margin: '18px 0 10px' }}>
            <div className="section-title" style={{ margin: 0, flex: 1 }}>الأصناف</div>
            {showLineAdd && (
              <>
                <div className="search" style={{ width: 280 }}>
                  <ScanLine />
                  <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onScan())} placeholder="امسح الباركود أو اكتب الكود (F2)" autoFocus={!params.id && !info.partyKind} />
                </div>
                {can('items.create') && <button className="btn" onClick={() => setNewItem(true)}><Plus /> صنف جديد</button>}
              </>
            )}
          </div>
          <div className="card doc-lines">
            <div className="line head">
              <div>الصنف</div>
              <div>الوحدة</div>
              <div>{type === 'stock_adjustment' ? 'الكمية الفعلية' : 'الكمية'}</div>
              <div>{type === 'stock_adjustment' || type === 'stock_transfer' ? 'الرصيد الحالي' : type === 'opening_stock' || isPurchase ? 'التكلفة' : 'السعر'}</div>
              <div>{info.priced ? 'الخصم' : type === 'stock_adjustment' ? 'الفرق' : ''}</div>
              <div>{info.priced || type === 'opening_stock' ? 'الإجمالي' : ''}</div>
              <div />
            </div>
            {lines.map((l, idx) => {
              const it = itemMap.get(l.item_id);
              const uopts = unitOptions(l.item_id);
              const have = avail[l.item_id];
              const haveInUnit = have !== undefined ? mulDiv(have, 1000, l.unit_factor) : undefined;
              const needsSerial = it?.track_serial && info.stock;
              const needsExpiry = it?.track_expiry && IN_DOCS.includes(type);
              return (
                <div key={l.id}>
                  <div className="line">
                    <div>
                      {l.ref_line_id ? (
                        <div className="bold">{it?.name}</div>
                      ) : (
                        <Picker
                          value={l.item_id || null}
                          options={itemOptions}
                          autoFocus={!l.item_id}
                          placeholder="اختر صنفًا"
                          onChange={async (v) => {
                            if (!v) return;
                            const nit = itemMap.get(v)!;
                            const u = { name: nit.base_unit, factor: 1000, sale_price: nit.sale_price, wholesale_price: nit.wholesale_price };
                            updLine(l.id, { item_id: v, unit_name: u.name, unit_factor: 1000, price: await defaultPrice(v, u), tax_rate_bp: info.priced ? nit.tax_rate_bp ?? 0 : 0, serials: [] });
                          }}
                        />
                      )}
                      {l.max_qty !== undefined && <div className="caption">المتاح للإرجاع: {formatQty(l.max_qty)}</div>}
                      {it?.is_service && <div className="caption">خدمة (بدون مخزون)</div>}
                      {info.priced && l.tax_rate_bp > 0 && <div className="caption">ضريبة {l.tax_rate_bp / 100}%</div>}
                    </div>
                    <div>
                      <select className="select" value={l.unit_name} disabled={!!l.ref_line_id || !l.item_id} onChange={async (e) => {
                        const u = uopts.find((x) => x.name === e.target.value)!;
                        updLine(l.id, { unit_name: u.name, unit_factor: u.factor, price: await defaultPrice(l.item_id, u) });
                      }}>
                        {uopts.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                      </select>
                    </div>
                    <div><QtyInput value={l.qty} onChange={(v) => updLine(l.id, { qty: v })} /></div>
                    <div>
                      {type === 'stock_adjustment' || type === 'stock_transfer' ? (
                        <span className="num muted">{haveInUnit !== undefined ? formatQty(haveInUnit) : '—'}</span>
                      ) : info.priced || type === 'opening_stock' ? (
                        <MoneyInput value={l.price} onChange={(v) => updLine(l.id, { price: v })} disabled={priceLocked || (!showCost && (isPurchase || type === 'opening_stock'))} />
                      ) : null}
                    </div>
                    <div>
                      {info.priced ? (
                        <MoneyInput value={l.discount} onChange={(v) => updLine(l.id, { discount: v })} disabled={discountLocked} />
                      ) : type === 'stock_adjustment' && haveInUnit !== undefined ? (
                        <span className={`num bold ${l.qty - haveInUnit < 0 ? 'red' : l.qty - haveInUnit > 0 ? 'green' : 'muted'}`}>{formatQty(l.qty - haveInUnit)}</span>
                      ) : null}
                    </div>
                    <div className="total">{calc && !calc.error && calc.lines[idx] ? formatMoney(calc.lines[idx].total) : ''}</div>
                    <div>
                      <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="حذف السطر"><Trash2 /></button>
                    </div>
                  </div>
                  {((needsSerial && !(type === 'sale_invoice' && h.deliver_later)) || needsExpiry) && (
                    <div className="row wrap" style={{ padding: '0 12px 10px', gap: 10, borderBottom: '0.5px solid var(--separator)' }}>
                      {needsSerial && !(type === 'sale_invoice' && h.deliver_later) && (
                        <div style={{ flex: 2, minWidth: 220 }}>
                          <SerialInput value={l.serials} need={Math.max(Math.round(l.qty / 1000), 0)} onChange={(v) => updLine(l.id, { serials: v })} />
                        </div>
                      )}
                      {needsExpiry && (
                        <Field label={`تاريخ الصلاحية${it.expiry_default_days ? ` (افتراضيًا بعد ${it.expiry_default_days} يوم)` : ''}`} className="" >
                          <input type="date" className="input" style={{ width: 180 }} value={l.expiry ?? ''} onChange={(e) => updLine(l.id, { expiry: e.target.value || null })} />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {showLineAdd && (
              <div className="line" style={{ gridTemplateColumns: '1fr' }}>
                <button className="btn plain" style={{ justifySelf: 'start' }} onClick={() => setLines((ls) => [...ls, { id: uuid(), item_id: '', unit_name: '', unit_factor: 1000, qty: 1000, price: 0, discount: 0, tax_rate_bp: 0, serials: [] }])}>
                  <Plus /> إضافة سطر
                </button>
              </div>
            )}
            {info.refType && !showLineAdd && lines.length === 0 && <div className="line muted" style={{ gridTemplateColumns: '1fr' }}>كل أصناف الفاتورة أُرجعت بالفعل.</div>}
          </div>
          {shortages.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Banner kind="warn">
                الرصيد المتاح (حسب هذا الجهاز) غير كافٍ: {shortages.map((s) => `${s.item?.name} (متاح ${formatQty(s.have)} / مطلوب ${formatQty(s.need)})`).join('، ')}.
                {settings.allow_negative_stock ? ' الإعدادات تسمح بالبيع بالسالب.' : ' عند الترحيل سيُحفظ المستند بحالة «يحتاج مراجعة» إذا لم يكفِ الرصيد مركزيًا.'}
              </Banner>
            </div>
          )}
        </>
      )}

      {/* ---------- القيد اليدوي ---------- */}
      {type === 'journal_voucher' && (
        <>
          <div className="section-title">سطور القيد</div>
          <div className="card doc-lines">
            <div className="line head" style={{ gridTemplateColumns: '2fr 1.5fr 130px 130px 1.4fr 36px' }}>
              <div>الحساب</div><div>الطرف (للعملاء/الموردين)</div><div>مدين</div><div>دائن</div><div>البيان</div><div />
            </div>
            {jl.map((l, i) => {
              const acc = accounts.find((a) => a.id === l.account_id);
              const needParty = acc?.system_key === 'ar' || acc?.system_key === 'ap';
              const upd = (p: any) => setJl(jl.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div className="line" key={i} style={{ gridTemplateColumns: '2fr 1.5fr 130px 130px 1.4fr 36px' }}>
                  <Picker value={l.account_id} options={leafAccounts()} onChange={(v) => upd({ account_id: v, party_id: null })} />
                  {needParty ? (
                    <Picker value={l.party_id} options={partyOptions.filter((p) => parties.find((x) => x.id === p.id)?.kind === (acc.system_key === 'ar' ? 'customer' : 'supplier'))} onChange={(v) => upd({ party_id: v })} />
                  ) : <span className="muted small">—</span>}
                  <MoneyInput value={l.debit} onChange={(v) => upd({ debit: v, credit: v ? 0 : l.credit })} />
                  <MoneyInput value={l.credit} onChange={(v) => upd({ credit: v, debit: v ? 0 : l.debit })} />
                  <input className="input" value={l.memo ?? ''} onChange={(e) => upd({ memo: e.target.value })} />
                  <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setJl(jl.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 /></button>
                </div>
              );
            })}
            <div className="line" style={{ gridTemplateColumns: '2fr 1.5fr 130px 130px 1.4fr 36px' }}>
              <button className="btn plain" style={{ justifySelf: 'start' }} onClick={() => setJl([...jl, { account_id: '', party_id: null, debit: 0, credit: 0, memo: '' }])}><Plus /> سطر</button>
              <div className="bold">الإجمالي</div>
              <div className="num bold">{formatMoney(jlTotals.dr)}</div>
              <div className="num bold">{formatMoney(jlTotals.cr)}</div>
              <div>{jlTotals.dr === jlTotals.cr && jlTotals.dr > 0 ? <span className="badge green">متوازن</span> : <span className="badge red">الفرق {formatMoney(Math.abs(jlTotals.dr - jlTotals.cr))}</span>}</div>
              <div />
            </div>
          </div>
        </>
      )}

      {/* ---------- الإجماليات والسداد ---------- */}
      <div className="grid grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="stack">
          {isInvoice && calc && !calc.error && (
            <div className="card pad stack">
              <div className="row">
                <div className="bold" style={{ flex: 1 }}>{type === 'purchase_invoice' ? 'مصروفات تُحمّل على التكلفة' : 'إضافات ومصروفات الفاتورة'}</div>
                <button className="btn sm" onClick={() => setCharges([...charges, { id: uuid(), name: type === 'purchase_invoice' ? 'شحن' : 'رسوم توصيل', mode: 'add', amount: 0 }])}><Plus /> إضافة</button>
                <button className="btn sm" onClick={() => setCharges([...charges, { id: uuid(), name: type === 'purchase_invoice' ? 'نقل' : 'مصروف', mode: 'expense', amount: 0, cashbox_id: cashboxes[0]?.id }])}><Plus /> مصروف</button>
              </div>
              {charges.length === 0 && (
                <div className="footnote">
                  {type === 'purchase_invoice'
                    ? '«إضافة» يحمّلها المورد على الفاتورة، و«مصروف» تدفعه أنت من خزينة. الاثنان يُوزعان على تكلفة الأصناف بالتناسب مع قيمتها.'
                    : '«إضافة» تُحصّل من العميل (مثل التوصيل) وتُسجل إيرادًا، و«مصروف» تدفعه أنت على الفاتورة من خزينة.'}
                </div>
              )}
              {charges.map((c, i) => {
                const upd = (p: Partial<Charge>) => setCharges(charges.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={c.id} className="row wrap" style={{ gap: 6 }}>
                    <select className="select" style={{ width: 110 }} value={c.mode} onChange={(e) => upd({ mode: e.target.value as any, cashbox_id: e.target.value === 'expense' ? c.cashbox_id ?? cashboxes[0]?.id : null })}>
                      <option value="add">إضافة</option>
                      <option value="expense">مصروف</option>
                    </select>
                    <input className="input" style={{ flex: 1, minWidth: 120 }} value={c.name} onChange={(e) => upd({ name: e.target.value })} placeholder="البيان" />
                    <div style={{ width: 120 }}><MoneyInput value={c.amount} onChange={(v) => upd({ amount: v })} /></div>
                    {c.mode === 'expense' && (
                      <select className="select" style={{ width: 150 }} value={c.cashbox_id ?? ''} onChange={(e) => upd({ cashbox_id: e.target.value })}>
                        {cashboxes.map((cb) => <option key={cb.id} value={cb.id}>{cb.name}</option>)}
                      </select>
                    )}
                    <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setCharges(charges.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 /></button>
                  </div>
                );
              })}
            </div>
          )}
          {hasPayments && calc && !calc.error && (
            <div className="card pad stack">
              <div className="row">
                <div className="bold" style={{ flex: 1 }}>{type.endsWith('return') ? 'رد النقدية' : 'السداد'}</div>
                <button className="btn sm" onClick={() => { setPayAuto(false); setPayments([...payments, { id: uuid(), cashbox_id: cashboxes[0]?.id, amount: Math.max(total - cashPaid - instTotal, 0) }]); }}><Plus /> خزينة</button>
                {payments.length > 0 && <button className="btn sm plain" onClick={() => { setPayAuto(false); setPayments([]); }}>آجل بالكامل</button>}
              </div>
              {payments.length === 0 && <div className="footnote">لا يوجد سداد نقدي؛ المبلغ بالكامل آجل{isInvoice ? ' (أو شيكات/أقساط)' : ''}.</div>}
              {payments.map((p, i) => {
                const cb = cashboxes.find((c) => c.id === p.cashbox_id);
                const fee = cb && (cb.fee_bp || cb.fee_min || cb.fee_fixed) ? Math.max(Math.round((p.amount * (cb.fee_bp ?? 0)) / 10000), cb.fee_min ?? 0) + (cb.fee_fixed ?? 0) : 0;
                return (
                  <div key={p.id} className="row" style={{ gap: 8 }}>
                    <select className="select" style={{ flex: 1 }} value={p.cashbox_id} onChange={(e) => { setPayAuto(false); setPayments(payments.map((x, j) => (j === i ? { ...x, cashbox_id: e.target.value } : x))); }}>
                      {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div style={{ width: 140 }}><MoneyInput value={p.amount} onChange={(v) => { setPayAuto(false); setPayments(payments.map((x, j) => (j === i ? { ...x, amount: v } : x))); }} /></div>
                    {fee > 0 && <span className="caption">عمولة {formatMoney(fee)}</span>}
                    <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => { setPayAuto(false); setPayments(payments.filter((_, j) => j !== i)); }} aria-label="حذف"><Trash2 /></button>
                  </div>
                );
              })}
              {isInvoice && h.party_id !== 'party-cash-customer' && (
                <>
                  <hr className="sep" style={{ margin: '6px 0' }} />
                  <div className="row">
                    <div className="bold" style={{ flex: 1 }}>شيكات وأقساط</div>
                    <button className="btn sm" onClick={() => setInsts([...insts, { id: uuid(), kind: 'cheque', amount: Math.max(credit, 0), due_date: h.date }])}><Plus /> شيك</button>
                    <button className="btn sm" onClick={() => setPlanOpen(true)} disabled={credit <= 0}><CalendarClock /> تقسيط</button>
                  </div>
                  {insts.map((x, i) => {
                    const upd = (p: Partial<Inst>) => setInsts(insts.map((y, j) => (j === i ? { ...y, ...p } : y)));
                    return (
                      <div key={x.id} className="row wrap" style={{ gap: 6 }}>
                        <select className="select" style={{ width: 100 }} value={x.kind} onChange={(e) => upd({ kind: e.target.value as any })}>
                          <option value="cheque">شيك</option>
                          <option value="installment">قسط</option>
                        </select>
                        <div style={{ width: 120 }}><MoneyInput value={x.amount} onChange={(v) => upd({ amount: v })} /></div>
                        <input type="date" className="input" style={{ width: 150 }} value={x.due_date} onChange={(e) => upd({ due_date: e.target.value })} title="تاريخ الاستحقاق" />
                        {x.kind === 'cheque' && <input className="input num" style={{ width: 110 }} placeholder="رقم الشيك" value={x.cheque_no ?? ''} onChange={(e) => upd({ cheque_no: e.target.value })} />}
                        {x.kind === 'cheque' && <input className="input" style={{ width: 120 }} placeholder="البنك" value={x.bank ?? ''} onChange={(e) => upd({ bank: e.target.value })} />}
                        <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setInsts(insts.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 /></button>
                      </div>
                    );
                  })}
                  {credit > 0 && (
                    <Field label="تاريخ استحقاق الجزء الآجل" hint="فارغ = حسب أيام الاستحقاق للطرف أو الإعدادات">
                      <input type="date" className="input" style={{ width: 180 }} value={h.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} />
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
          <div className="card pad">
            <Field label={type === 'stock_adjustment' ? 'سبب الجرد/التسوية *' : 'ملاحظات'}>
              <textarea className="textarea" value={h.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
        {calc && !calc.error && (
          <div className="card pad totals-box">
            {info.priced && (
              <>
                <div className="tr"><span className="muted">الإجمالي قبل الخصم</span><span className="num">{formatMoney(calc.gross)}</span></div>
                <div className="tr" style={{ alignItems: 'center' }}>
                  <span className="muted">خصم على الفاتورة</span>
                  <span style={{ width: 140 }}><MoneyInput value={h.discount} onChange={(v) => set('discount', v)} disabled={discountLocked} /></span>
                </div>
                <div className="tr"><span className="muted">إجمالي الخصومات</span><span className="num">{formatMoney(calc.discount)}</span></div>
                <div className="tr"><span className="muted">الضريبة</span><span className="num">{formatMoney(calc.tax)}</span></div>
                {chargesAdd > 0 && <div className="tr"><span className="muted">إضافات</span><span className="num">{formatMoney(chargesAdd)}</span></div>}
              </>
            )}
            <div className="tr grand"><span>الإجمالي</span><span className="num">{formatMoney(total)}</span></div>
            {hasPayments && (
              <>
                <div className="tr"><span className="muted">{type.endsWith('return') ? 'مردود نقدًا' : 'مدفوع نقدًا'}</span><span className="num">{formatMoney(cashPaid)}</span></div>
                {instTotal > 0 && <div className="tr"><span className="muted">شيكات وأقساط</span><span className="num">{formatMoney(instTotal)}</span></div>}
                <div className={`tr bold ${credit < 0 ? 'red' : ''}`}><span>{credit < 0 ? 'زيادة عن الإجمالي' : 'آجل'}</span><span className="num">{formatMoney(Math.abs(credit))}</span></div>
              </>
            )}
          </div>
        )}
        {calc?.error && <Banner kind="err">{calc.error}</Banner>}
      </div>
      <div className="footnote" style={{ marginTop: 14 }}>
        الاختصارات: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ترحيل · <kbd>Ctrl</kbd>+<kbd>S</kbd> مسودة · <kbd>F2</kbd> الباركود
      </div>

      {newItem && <ItemEditor item={null} onClose={() => setNewItem(false)} onSaved={(id) => setTimeout(() => void addItem(id), 50)} />}
      {newParty && <PartyEditor kind={info.partyKind === 'supplier' ? 'supplier' : 'customer'} party={null} onClose={() => setNewParty(false)} onSaved={(id) => set('party_id', id)} />}
      {planOpen && (
        <InstallmentPlan
          amount={credit}
          start={h.date}
          onClose={() => setPlanOpen(false)}
          onApply={(rows) => {
            setInsts([...insts, ...rows]);
            setPlanOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SerialInput({ value, need, onChange }: { value: string[]; need: number; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setText('');
  };
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input num" placeholder="امسح أو اكتب السيريال ثم Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <span className={`badge ${value.length === need ? 'green' : 'orange'}`}>{value.length}/{need}</span>
      </div>
      {value.length > 0 && (
        <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
          {value.map((s) => (
            <span key={s} className="badge blue" style={{ cursor: 'pointer' }} title="حذف" onClick={() => onChange(value.filter((x) => x !== s))}>{s} ×</span>
          ))}
        </div>
      )}
    </div>
  );
}

function InstallmentPlan({ amount, start, onClose, onApply }: { amount: number; start: string; onClose: () => void; onApply: (rows: Inst[]) => void }) {
  const [n, setN] = useState(3);
  const [first, setFirst] = useState(() => {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [every, setEvery] = useState(1);
  const rows = useMemo(() => {
    const out: Inst[] = [];
    const base = Math.floor(amount / n);
    for (let i = 0; i < n; i++) {
      const d = new Date(first + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + i * every);
      out.push({ id: uuid(), kind: 'installment', amount: i === n - 1 ? amount - base * (n - 1) : base, due_date: d.toISOString().slice(0, 10) });
    }
    return out;
  }, [amount, n, first, every]);
  return (
    <Sheet title="جدولة أقساط" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={() => onApply(rows)} disabled={n < 1 || amount <= 0}>إضافة الأقساط</button></>}>
      <div className="stack">
        <div className="footnote">المبلغ المقسط: <span className="num bold">{formatMoney(amount)}</span></div>
        <div className="grid grid-3">
          <Field label="عدد الأقساط"><input className="input num" type="number" min={1} max={120} value={n} onChange={(e) => setN(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} /></Field>
          <Field label="أول استحقاق"><input type="date" className="input" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="كل (شهر)"><input className="input num" type="number" min={1} max={12} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} /></Field>
        </div>
        <div className="list">
          {rows.map((r, i) => (
            <div key={r.id} className="list-row"><span className="muted" style={{ width: 30 }}>{i + 1}</span><div className="title num">{r.due_date}</div><span className="num">{formatMoney(r.amount)}</span></div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function InvoiceLink({ type, partyId, value, onChange }: { type: 'receipt' | 'payment'; partyId: string; value: string | null; onChange: (id: string | null, remaining?: number) => void }) {
  const invs = useLiveQuery(async () => {
    const want = type === 'receipt' ? 'sale_invoice' : 'purchase_invoice';
    return (await db.documents.where('party_id').equals(partyId).toArray()).filter((d) => d.doc_type === want && d.status === 'posted' && !d._sync && d.paid < d.total && !d.closed);
  }, [partyId, type]) ?? [];
  if (!invs.length) return null;
  return (
    <Field label="ربط بفاتورة (اختياري)">
      <select className="select" value={value ?? ''} onChange={(e) => { const d = invs.find((x) => x.id === e.target.value); onChange(e.target.value || null, d ? d.total - d.paid : undefined); }}>
        <option value="">تلقائي (الأقدم أولًا)</option>
        {invs.map((d) => <option key={d.id} value={d.id}>{d.number} — متبقي {formatMoney(d.total - d.paid)}</option>)}
      </select>
    </Field>
  );
}
