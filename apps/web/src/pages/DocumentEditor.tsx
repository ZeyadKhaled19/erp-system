import {
  computeDocument, DOC_TYPES, formatMoney, formatQty, hasPermission, mulDiv, todayISO, toBaseQty, uuid, type DocInput, type DocType,
} from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ScanLine, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Field, MoneyInput, Picker, QtyInput, Segmented, useUi, type PickOption } from '../components/ui';
import { localAvailable, saveDocument } from '../lib/actions';
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
  /** للمرتجع: الحد الأقصى بالوحدة المختارة */
  max_qty?: number;
}

const EFFECT: Partial<Record<DocType, string>> = {
  sale_invoice: 'سيُخصم المخزون ويُسجل قيد المبيعات والتكلفة وتُحدّث الخزينة وحساب العميل.',
  sale_return: 'ستُعاد الكميات للمخزن ويُسجل قيد المرتجع ويُخفض حساب العميل (أو تُرد النقدية).',
  purchase_invoice: 'ستُضاف الكميات للمخزن بالتكلفة ويُحدّث متوسط التكلفة وحساب المورد والخزينة.',
  purchase_return: 'ستُخصم الكميات من المخزن ويُخفض حساب المورد.',
  receipt: 'سيُضاف المبلغ للخزينة ويُخفض رصيد الطرف/الحساب.',
  payment: 'سيُخصم المبلغ من الخزينة ويُخفض المستحق للطرف/الحساب.',
  expense: 'سيُخصم المبلغ من الخزينة ويُسجل على حساب المصروف.',
  income: 'سيُضاف المبلغ للخزينة ويُسجل على حساب الإيراد.',
  stock_transfer: 'ستُنقل الكميات وتكلفتها من المخزن الأول للثاني.',
  stock_adjustment: 'ستُعدّل أرصدة المخزن لتساوي الكميات الفعلية ويُسجل فرق الجرد في الحسابات.',
  opening_stock: 'ستُضاف الكميات كبضاعة أول المدة ويُسجل قيد الأرصدة الافتتاحية.',
  party_opening: 'سيُسجل الرصيد الافتتاحي في حساب الطرف مقابل حساب الأرصدة الافتتاحية.',
  journal_voucher: 'سيُرحّل القيد على الحسابات المحددة.',
};

export function DocumentEditor() {
  const params = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ui = useUi();
  const { session } = useSession();
  const perms = session.user.permissions;
  const can = (k: string) => hasPermission(perms, k);
  const settings = useSettings();

  const existing = useLiveQuery(async () => (params.id ? ((await db.documents.get(params.id)) ?? null) : null), [params.id]);
  const existingLines = useLiveQuery(async () => (params.id ? db.document_lines.where('document_id').equals(params.id).sortBy('line_no') : []), [params.id]);
  const type = (params.type ?? existing?.doc_type) as DocType;
  const info = DOC_TYPES[type];

  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];
  const units = useLiveQuery(() => db.item_units.toArray(), []) ?? [];
  const parties = useLiveQuery(() => db.parties.toArray(), []) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const cashboxes = useLiveQuery(async () => (await db.cashboxes.toArray()).filter((c) => c.active !== false), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const isSale = type?.startsWith('sale');
  const isPurchase = type?.startsWith('purchase');

  // ---------------- الحالة
  const [ready, setReady] = useState(false);
  const [h, setH] = useState<any>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [jl, setJl] = useState<any[]>([]);
  const [counterMode, setCounterMode] = useState<'party' | 'account'>('party');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [newItem, setNewItem] = useState(false);
  const [newParty, setNewParty] = useState(false);
  const [scan, setScan] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready || !info) return;
    if (params.id) {
      if (existing === undefined || existingLines === undefined) return;
      if (!existing) return;
      setH({ ...existing });
      setLines(existingLines.map((l: any) => ({ ...l })));
      setJl(existing.data?.journal_lines ?? []);
      setCounterMode(existing.account_id && !existing.party_id ? 'account' : 'party');
      setReady(true);
      return;
    }
    const party = sp.get('party');
    setH({
      date: todayISO(),
      warehouse_id: warehouses[0]?.id ?? 'wh-main',
      to_warehouse_id: '',
      cashbox_id: cashboxes[0]?.id ?? 'cb-main',
      party_id: party ?? (type === 'sale_invoice' ? 'party-cash-customer' : null),
      payment_type: isPurchase ? 'credit' : 'cash',
      paid: 0,
      amount: 0,
      discount: 0,
      side: type === 'party_opening' ? 'debit' : null,
      ref_doc_id: sp.get('ref'),
      notes: '',
    });
    setJl([
      { account_id: '', party_id: null, debit: 0, credit: 0, memo: '' },
      { account_id: '', party_id: null, debit: 0, credit: 0, memo: '' },
    ]);
    if (warehouses.length && cashboxes.length) setReady(true);
  }, [ready, info, params.id, existing, existingLines, warehouses, cashboxes, sp, type, isPurchase]);

  const set = (k: string, v: unknown) => setH((p: any) => ({ ...p, [k]: v }));
  const party = parties.find((p) => p.id === h.party_id);
  const priceList = party?.price_list ?? 'retail';

  // ---------------- المرتجع: تحميل سطور الفاتورة الأصلية
  const refDocs = useLiveQuery(async () => {
    if (!info?.refType || !h.party_id) return [];
    return (await db.documents.where('party_id').equals(h.party_id).toArray())
      .filter((d) => d.doc_type === info.refType && d.status === 'posted' && !d._sync)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [info?.refType, h.party_id]) ?? [];

  const loadRef = useCallback(
    async (refId: string | null) => {
      set('ref_doc_id', refId);
      if (!refId) return;
      const ref = await db.documents.get(refId);
      const refLines = await db.document_lines.where('document_id').equals(refId).sortBy('line_no');
      // الكميات المرتجعة سابقًا
      const prior = (await db.documents.where('ref_doc_id').equals(refId).toArray()).filter((d) => d.status === 'posted' && d.id !== params.id);
      const returned = new Map<string, number>();
      for (const p of prior) for (const l of await db.document_lines.where('document_id').equals(p.id).toArray()) returned.set(l.ref_line_id, (returned.get(l.ref_line_id) ?? 0) + l.base_qty);
      setLines(
        refLines
          .map((l) => {
            const remainingBase = l.base_qty - (returned.get(l.id) ?? 0);
            const maxQty = mulDiv(remainingBase, 1000, l.unit_factor);
            const netUnitPrice = l.qty ? mulDiv(l.total - l.tax, 1000, l.qty) : l.price;
            return { id: uuid(), item_id: l.item_id, unit_name: l.unit_name, unit_factor: l.unit_factor, qty: maxQty, price: netUnitPrice, discount: 0, tax_rate_bp: l.tax_rate_bp, ref_line_id: l.id, max_qty: maxQty };
          })
          .filter((l) => l.max_qty > 0),
      );
      if (ref?.warehouse_id) set('warehouse_id', ref.warehouse_id);
    },
    [params.id],
  );
  useEffect(() => {
    if (ready && !params.id && h.ref_doc_id && lines.length === 0) void loadRef(h.ref_doc_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ---------------- السطور
  const unitOptions = (itemId: string) => {
    const it = itemMap.get(itemId);
    if (!it) return [];
    return [{ name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price }, ...units.filter((u) => u.item_id === itemId && u.active !== false)] as any[];
  };
  const defaultPrice = (itemId: string, unit: { factor: number; sale_price?: number; wholesale_price?: number }) => {
    const it = itemMap.get(itemId);
    if (!it) return 0;
    if (isSale) {
      const p = priceList === 'wholesale' ? unit.wholesale_price || unit.sale_price : unit.sale_price;
      return p || mulDiv(it.sale_price, unit.factor, 1000);
    }
    if (isPurchase || type === 'opening_stock') return mulDiv(it.last_cost || it.avg_cost || 0, unit.factor, 1000);
    return 0;
  };
  const addItem = (itemId: string, unitName?: string) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    const u = unitOptions(itemId).find((x) => x.name === (unitName ?? it.base_unit))!;
    setLines((ls) => {
      const same = ls.find((l) => l.item_id === itemId && l.unit_name === u.name && !l.ref_line_id);
      if (same && type !== 'stock_adjustment') return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1000 } : l));
      return [
        ...ls,
        { id: uuid(), item_id: itemId, unit_name: u.name, unit_factor: u.factor, qty: type === 'stock_adjustment' ? 0 : 1000, price: defaultPrice(itemId, u), discount: 0, tax_rate_bp: info.priced ? (it.tax_rate_bp ?? 0) : 0 },
      ];
    });
  };
  const updLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const onScan = async () => {
    const code = scan.trim();
    if (!code) return;
    const unit = await db.item_units.where('barcode').equals(code).first();
    if (unit) {
      addItem(unit.item_id, unit.name);
      setScan('');
      return;
    }
    const it = (await db.items.where('barcode').equals(code).first()) ?? (await db.items.where('code').equals(code).first());
    if (it) {
      addItem(it.id);
      setScan('');
    } else ui.toast(`لا يوجد صنف بالكود/الباركود ${code}`, 'err');
  };

  // الرصيد المتاح محليًا لتحذير البيع/الصرف بأكثر من الرصيد
  useEffect(() => {
    if (!info?.stock || !h.warehouse_id) return;
    let alive = true;
    (async () => {
      const r: Record<string, number> = {};
      for (const id of new Set(lines.map((l) => l.item_id))) r[id] = await localAvailable(id, h.warehouse_id, params.id);
      if (alive) setAvail(r);
    })();
    return () => {
      alive = false;
    };
  }, [lines, h.warehouse_id, info?.stock, params.id]);

  // ---------------- الحساب
  const calc = useMemo(() => {
    if (!info) return null;
    if (!info.priced && type !== 'opening_stock') return null;
    try {
      return computeDocument(
        lines.map((l) => ({ qty: Math.max(l.qty, 0), price: l.price, discount: info.priced ? l.discount : 0, tax_rate_bp: info.priced ? l.tax_rate_bp : 0 })),
        info.priced ? h.discount ?? 0 : 0,
      );
    } catch (e) {
      return { error: (e as Error).message } as any;
    }
  }, [lines, h.discount, info, type]);

  const shortages = useMemo(() => {
    if (!info || !(info.stock === 'out' || info.stock === 'transfer')) return [];
    const need = new Map<string, number>();
    lines.forEach((l) => need.set(l.item_id, (need.get(l.item_id) ?? 0) + toBaseQty(Math.max(l.qty, 0), l.unit_factor)));
    return [...need.entries()].filter(([id, q]) => q > (avail[id] ?? 0)).map(([id, q]) => ({ item: itemMap.get(id), need: q, have: avail[id] ?? 0 }));
  }, [lines, avail, info, itemMap]);

  const jlTotals = useMemo(() => ({ dr: jl.reduce((s, l) => s + (l.debit || 0), 0), cr: jl.reduce((s, l) => s + (l.credit || 0), 0) }), [jl]);

  // ---------------- خيارات المنتقيات
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
  const buildDoc = (): DocInput => ({
    id: params.id ?? h.id ?? uuid(),
    doc_type: type,
    date: h.date,
    party_id: counterMode === 'account' && (type === 'receipt' || type === 'payment') ? null : h.party_id || null,
    warehouse_id: info.stock ? h.warehouse_id : null,
    to_warehouse_id: info.stock === 'transfer' ? h.to_warehouse_id || null : null,
    cashbox_id: info.priced ? (h.payment_type === 'cash' || h.paid > 0 ? h.cashbox_id : null) : ['receipt', 'payment', 'expense', 'income'].includes(type) ? h.cashbox_id : null,
    account_id: ['expense', 'income'].includes(type) || (counterMode === 'account' && ['receipt', 'payment'].includes(type)) ? h.account_id || null : null,
    payment_type: info.priced ? h.payment_type : null,
    paid: info.priced ? (h.payment_type === 'cash' ? calc?.total ?? 0 : h.paid ?? 0) : 0,
    amount: h.amount ?? 0,
    discount: info.priced ? h.discount ?? 0 : 0,
    ref_doc_id: h.ref_doc_id || null,
    side: type === 'party_opening' ? h.side : null,
    notes: h.notes || null,
    local_number: h.local_number ?? null,
    lines: lines
      .filter((l) => l.item_id)
      .map((l) => ({ id: l.id, item_id: l.item_id, unit_name: l.unit_name, unit_factor: l.unit_factor, qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp, ref_line_id: l.ref_line_id ?? null, notes: null })),
    journal_lines: type === 'journal_voucher' ? jl.filter((l) => l.account_id && (l.debit || l.credit)).map((l) => ({ account_id: l.account_id, party_id: l.party_id || null, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || null })) : [],
  });

  const validate = (d: DocInput): string | null => {
    if (!d.date) return 'التاريخ مطلوب';
    if (info.hasLines && d.lines.length === 0) return 'أضف صنفًا واحدًا على الأقل';
    if (info.stock === 'transfer' && (!d.to_warehouse_id || d.to_warehouse_id === d.warehouse_id)) return 'اختر مخزنًا مختلفًا للتحويل إليه';
    if (info.stock !== 'adjust' && d.lines.some((l) => l.qty <= 0)) return 'كل الكميات يجب أن تكون أكبر من صفر';
    if (lines.some((l) => l.max_qty !== undefined && l.qty > l.max_qty)) return 'كمية المرتجع أكبر من المتبقي في الفاتورة';
    if (info.refType && d.lines.some((l) => !l.ref_line_id)) return 'اختر الفاتورة الأصلية للمرتجع';
    if (calc?.error) return calc.error;
    if (info.priced) {
      if (d.payment_type === 'credit' && d.party_id === 'party-cash-customer') return 'البيع الآجل يحتاج اختيار عميل مسجل';
      if (d.paid > (calc?.total ?? 0)) return 'المدفوع أكبر من الإجمالي';
      if (d.paid > 0 && !d.cashbox_id) return 'اختر الخزينة';
      if (!d.party_id && isPurchase) return 'اختر المورد';
    }
    if (['receipt', 'payment'].includes(type) && !d.party_id && !d.account_id) return 'اختر الطرف أو الحساب';
    if (['expense', 'income'].includes(type) && !d.account_id) return 'اختر الحساب';
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
    if (v) {
      setError(v);
      return;
    }
    if (action === 'post') {
      const extra = shortages.length ? `\n\nتنبيه: الرصيد المتاح على هذا الجهاز أقل من المطلوب لـ ${shortages.map((s) => s.item?.name).join('، ')}. إذا لم يكفِ الرصيد مركزيًا سيُحفظ المستند بحالة «يحتاج مراجعة».` : '';
      const ok = await ui.confirm({
        title: `ترحيل ${info.label}؟`,
        message: (EFFECT[type] ?? '') + extra + '\nبعد الترحيل لا يمكن التعديل، ويتم التصحيح بالإلغاء أو بمستند عكسي.',
        confirmLabel: 'ترحيل',
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
  if (params.id && existing && existing.status !== 'draft' && existing.status !== 'pending_review' && existing._sync !== 'rejected')
    return <div className="page"><Banner kind="warn">هذا المستند {existing.status === 'posted' ? 'مُرحّل' : 'ملغي'} ولا يمكن تعديله.</Banner></div>;
  if (!ready) return <div className="page muted">جارٍ التحميل…</div>;

  const priceLocked = isSale && !can('sales.price_change');
  const discountLocked = isSale && !can('sales.discount');
  const showCost = can('costs.view');

  return (
    <div className="page">
      <PageHeader
        title={`${params.id ? 'تعديل ' : ''}${info.label}`}
        sub={existing ? <span className="num">{existing.number ?? existing.local_number}</span> : 'مستند جديد'}
        actions={
          <>
            <button className="btn" disabled={busy} onClick={() => submit('draft')} title="Ctrl+S">حفظ مسودة</button>
            <button className="btn primary" disabled={busy} onClick={() => submit('post')} title="Ctrl+Enter">ترحيل</button>
          </>
        }
      />
      {existing?._error && <div style={{ marginBottom: 12 }}><Banner kind="err">{existing._error}</Banner></div>}
      {existing?.review_reason && <div style={{ marginBottom: 12 }}><Banner kind="warn">{existing.review_reason}</Banner></div>}
      {error && <div style={{ marginBottom: 12 }}><Banner kind="err">{error}</Banner></div>}

      {/* ---------- رأس المستند ---------- */}
      <div className="card pad">
        <div className="grid grid-4">
          <Field label="التاريخ">
            <input type="date" className="input" value={h.date} onChange={(e) => set('date', e.target.value)} />
          </Field>

          {(info.partyKind || type === 'party_opening') && (type !== 'receipt' && type !== 'payment' || counterMode === 'party') && (
            <Field label={info.partyKind === 'supplier' ? 'المورد' : info.partyKind === 'customer' ? 'العميل' : 'الطرف'}>
              <div className="row" style={{ gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <Picker value={h.party_id} options={partyOptions} onChange={(v) => { set('party_id', v); if (info.refType) { set('ref_doc_id', null); setLines([]); } }} placeholder="ابحث بالاسم أو الكود" />
                </div>
                {info.partyKind !== 'any' && can('parties.create') && (
                  <button type="button" className="icon-btn" title="إضافة جديد" onClick={() => setNewParty(true)}>
                    <UserPlus />
                  </button>
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
              <Picker value={h.account_id} options={leafAccounts((a) => a.type === (type === 'expense' ? 'expense' : 'revenue') && !['cogs', 'inventory_diff', 'cost_variance', 'sales', 'sales_returns', 'sales_discount'].includes(a.system_key))} onChange={(v) => set('account_id', v)} />
            </Field>
          )}

          {info.stock && (
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
                {warehouses.filter((w) => w.id !== h.warehouse_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          )}

          {info.refType && (
            <Field label="الفاتورة الأصلية">
              <select className="select" value={h.ref_doc_id ?? ''} onChange={(e) => loadRef(e.target.value || null)} disabled={!h.party_id}>
                <option value="">{h.party_id ? 'اختر الفاتورة…' : 'اختر الطرف أولًا'}</option>
                {refDocs.map((d) => <option key={d.id} value={d.id}>{d.number} — {d.date} — {formatMoney(d.total)}</option>)}
              </select>
            </Field>
          )}

          {info.priced && (
            <Field label="طريقة الدفع">
              <Segmented block value={h.payment_type} onChange={(v) => set('payment_type', v)} options={[{ value: 'cash', label: type.endsWith('return') ? 'رد نقدي' : 'نقدي' }, { value: 'credit', label: 'آجل' }]} />
            </Field>
          )}
          {(info.priced || ['receipt', 'payment', 'expense', 'income'].includes(type)) && (
            <Field label="الخزينة">
              <select className="select" value={h.cashbox_id ?? ''} onChange={(e) => set('cashbox_id', e.target.value)}>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {type === 'party_opening' && (
            <Field label="طبيعة الرصيد">
              <Segmented block value={h.side} onChange={(v) => set('side', v)} options={[{ value: 'debit', label: party?.kind === 'supplier' ? 'مدين (له علينا ↓)' : 'عليه لنا' }, { value: 'credit', label: party?.kind === 'supplier' ? 'له عندنا' : 'دائن (له عندنا)' }]} />
            </Field>
          )}
          {!info.hasLines && type !== 'journal_voucher' && (
            <Field label="المبلغ">
              <MoneyInput value={h.amount} onChange={(v) => set('amount', v)} autoFocus />
            </Field>
          )}
          {(type === 'receipt' || type === 'payment') && counterMode === 'party' && h.party_id && <InvoiceLink type={type} partyId={h.party_id} value={h.ref_doc_id} onChange={(v, rem) => { set('ref_doc_id', v); if (v && rem) set('amount', rem); }} />}
        </div>
        {party && (isSale || type === 'receipt') && party.kind === 'customer' && party.id !== 'party-cash-customer' && (
          <div className="footnote" style={{ marginTop: 10 }}>
            رصيد العميل الحالي: <span className="num bold">{formatMoney(party.balance ?? 0)}</span>
            {party.credit_limit ? <> · الحد الائتماني <span className="num">{formatMoney(party.credit_limit)}</span></> : null}
            {priceList === 'wholesale' && ' · أسعار الجملة'}
          </div>
        )}
      </div>

      {/* ---------- السطور ---------- */}
      {info.hasLines && (
        <>
          <div className="row wrap" style={{ margin: '18px 0 10px' }}>
            <div className="section-title" style={{ margin: 0, flex: 1 }}>الأصناف</div>
            {!info.refType && (
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
              return (
                <div className="line" key={l.id}>
                  <div>
                    {l.ref_line_id || !l.item_id ? (
                      l.item_id ? <div className="bold">{it?.name}</div> : <Picker value={l.item_id} options={itemOptions} onChange={(v) => v && (setLines((ls) => ls.filter((x) => x.id !== l.id)), addItem(v))} placeholder="اختر صنفًا" autoFocus />
                    ) : (
                      <Picker value={l.item_id} options={itemOptions} onChange={(v) => {
                        if (!v) return;
                        const nit = itemMap.get(v)!;
                        const u = { name: nit.base_unit, factor: 1000, sale_price: nit.sale_price, wholesale_price: nit.wholesale_price };
                        updLine(l.id, { item_id: v, unit_name: u.name, unit_factor: 1000, price: defaultPrice(v, u), tax_rate_bp: info.priced ? nit.tax_rate_bp ?? 0 : 0 });
                      }} />
                    )}
                    {l.max_qty !== undefined && <div className="caption">المتاح للإرجاع: {formatQty(l.max_qty)}</div>}
                    {info.priced && l.tax_rate_bp > 0 && <div className="caption">ضريبة {l.tax_rate_bp / 100}%</div>}
                  </div>
                  <div>
                    <select className="select" value={l.unit_name} disabled={!!l.ref_line_id} onChange={(e) => {
                      const u = uopts.find((x) => x.name === e.target.value)!;
                      updLine(l.id, { unit_name: u.name, unit_factor: u.factor, price: defaultPrice(l.item_id, u) });
                    }}>
                      {uopts.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                    </select>
                  </div>
                  <div><QtyInput value={l.qty} onChange={(v) => updLine(l.id, { qty: v })} autoFocus={idx === lines.length - 1 && !params.id && !l.ref_line_id} /></div>
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
                    <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="حذف السطر">
                      <Trash2 />
                    </button>
                  </div>
                </div>
              );
            })}
            {!info.refType && (
              <div className="line" style={{ gridTemplateColumns: '1fr' }}>
                <button className="btn plain" style={{ justifySelf: 'start' }} onClick={() => setLines((ls) => [...ls, { id: uuid(), item_id: '', unit_name: '', unit_factor: 1000, qty: 1000, price: 0, discount: 0, tax_rate_bp: 0 }])}>
                  <Plus /> إضافة سطر
                </button>
              </div>
            )}
            {info.refType && lines.length === 0 && <div className="line muted" style={{ gridTemplateColumns: '1fr' }}>اختر {info.partyKind === 'customer' ? 'العميل' : 'المورد'} ثم الفاتورة الأصلية لعرض أصنافها.</div>}
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

      {/* ---------- الإجماليات والملاحظات ---------- */}
      <div className="grid grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card pad">
          <Field label={type === 'stock_adjustment' ? 'سبب الجرد/التسوية *' : 'ملاحظات'}>
            <textarea className="textarea" value={h.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
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
              </>
            )}
            <div className="tr grand"><span>الإجمالي</span><span className="num">{formatMoney(calc.total)}</span></div>
            {info.priced && h.payment_type === 'credit' && (
              <>
                <div className="tr" style={{ alignItems: 'center' }}>
                  <span className="muted">{type.endsWith('return') ? 'المبلغ المردود نقدًا' : 'المدفوع الآن'}</span>
                  <span style={{ width: 140 }}><MoneyInput value={h.paid} onChange={(v) => set('paid', v)} /></span>
                </div>
                <div className="tr bold"><span>المتبقي (آجل)</span><span className="num">{formatMoney(calc.total - (h.paid ?? 0))}</span></div>
              </>
            )}
          </div>
        )}
        {calc?.error && <Banner kind="err">{calc.error}</Banner>}
      </div>
      <div className="footnote" style={{ marginTop: 14 }}>
        الاختصارات: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ترحيل · <kbd>Ctrl</kbd>+<kbd>S</kbd> مسودة · <kbd>F2</kbd> الباركود
      </div>

      {newItem && <ItemEditor item={null} onClose={() => setNewItem(false)} onSaved={(id) => setTimeout(() => addItem(id), 50)} />}
      {newParty && <PartyEditor kind={info.partyKind === 'supplier' ? 'supplier' : 'customer'} party={null} onClose={() => setNewParty(false)} onSaved={(id) => set('party_id', id)} />}
    </div>
  );
}

function InvoiceLink({ type, partyId, value, onChange }: { type: 'receipt' | 'payment'; partyId: string; value: string | null; onChange: (id: string | null, remaining?: number) => void }) {
  const invs = useLiveQuery(async () => {
    const want = type === 'receipt' ? 'sale_invoice' : 'purchase_invoice';
    return (await db.documents.where('party_id').equals(partyId).toArray()).filter((d) => d.doc_type === want && d.status === 'posted' && !d._sync && d.paid < d.total);
  }, [partyId, type]) ?? [];
  if (!invs.length) return null;
  return (
    <Field label="ربط بفاتورة (اختياري)">
      <select className="select" value={value ?? ''} onChange={(e) => { const d = invs.find((x) => x.id === e.target.value); onChange(e.target.value || null, d ? d.total - d.paid : undefined); }}>
        <option value="">بدون ربط</option>
        {invs.map((d) => <option key={d.id} value={d.id}>{d.number} — متبقي {formatMoney(d.total - d.paid)}</option>)}
      </select>
    </Field>
  );
}
