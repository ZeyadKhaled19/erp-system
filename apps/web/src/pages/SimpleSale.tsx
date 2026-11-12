import { computeDocument, formatMoney, formatQty, hasPermission, mulDiv, parseMoney, todayISO, toBaseQty, uuid, type DocInput } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Check, Clock3, CreditCard, Plus, Printer, Settings2, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QuickItemSheet } from '../components/QuickItem';
import { QuickPartySheet } from '../components/QuickParty';
import { CustomerFields } from '../components/CustomerFields';
import { CategoryFilter } from '../components/Categories';
import { Banner, FloatingPop, GroupChips, MoneyInput, Picker, QtyInput, useUi } from '../components/ui';
import { priceFor, saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession } from '../lib/hooks';
import { useCostMap } from '../lib/costs';
import { CostCard, useHoverCard } from '../components/HoverCard';

interface Line {
  id: string;
  item_id: string;
  unit_name: string;
  unit_factor: number;
  qty: number;
  price: number;
  discount: number;
  tax_rate_bp: number;
}

/**
 * فاتورة بيع في شاشة واحدة بسيطة:
 * سطر إدخال (الصنف ← الكمية ← السعر ← أضف) بالتنقل بـ Enter، جدول الأصناف،
 * الإجمالي الكبير والعميل وطرق الدفع ظاهرة، وحفظ بزر واحد (F12).
 */
interface Draft {
  date?: string;
  partyId?: string;
  notes?: string;
  lines?: Line[];
  discount?: number;
  method?: string;
  paidText?: string;
}
interface TabSummary {
  count: number;
  total: number;
  party: string | null;
}
const draftKey = (id: string) => `sale-draft-${id}`;
function loadDraft(id: string): Draft {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function storeSet(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* التخزين غير متاح */
  }
}

/**
 * فواتير بيع متعددة في تبويبات: كل تبويب فاتورة مستقلة محفوظة كمسودة على الجهاز
 * (لا تضيع عند التنقل أو إعادة التحميل) حتى تُحفظ.
 */
export function SimpleSalePage() {
  const ui = useUi();
  const [tabs, setTabs] = useState<string[]>(() => {
    try {
      const t = JSON.parse(localStorage.getItem('sale-tabs') ?? '[]');
      if (Array.isArray(t) && t.length) return t;
    } catch {
      /* ignore */
    }
    return [uuid()];
  });
  const [active, setActive] = useState(tabs[0]);
  const [sums, setSums] = useState<Record<string, TabSummary>>({});
  useEffect(() => storeSet('sale-tabs', tabs), [tabs]);
  const cur = tabs.includes(active) ? active : tabs[0];

  const newTab = () => {
    if (tabs.length >= 12) return ui.toast('الحد الأقصى 12 فاتورة مفتوحة', 'err');
    const id = uuid();
    setTabs((t) => [...t, id]);
    setActive(id);
  };
  const closeTab = async (id: string, ask = true) => {
    if (ask && (sums[id]?.count ?? 0) > 0) {
      const ok = await ui.confirm({ title: 'إغلاق الفاتورة؟', message: 'الفاتورة فيها أصناف لم تُحفظ وستُحذف.', confirmLabel: 'إغلاق', destructive: true });
      if (!ok) return;
    }
    storeSet(draftKey(id), null);
    setTabs((t) => {
      const i = t.indexOf(id);
      const n = t.filter((x) => x !== id);
      if (!n.length) n.push(uuid());
      if (id === cur) setActive(n[Math.max(0, i - 1)] ?? n[0]);
      return n;
    });
  };

  useEffect(() => {
    document.title = 'فاتورة بيع — الحسابات';
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'فاتورة بيع';
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.altKey && (e.key === 'n' || e.key === 'ى'))) {
        e.preventDefault();
        newTab();
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const i = tabs.indexOf(cur);
        setActive(tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <>
      <div className="ss-tabs">
        {tabs.map((id, i) => {
          const s = sums[id];
          return (
            <div key={id} className={`ss-tab ${id === cur ? 'on' : ''}`} onClick={() => setActive(id)} role="tab" aria-selected={id === cur}>
              <span className="ss-tab-n">{i + 1}</span>
              <span className="ss-tab-t">{s?.party ?? 'فاتورة جديدة'}</span>
              {s && s.count > 0 && <span className="ss-tab-v num">{formatMoney(s.total)}</span>}
              <button className="ss-tab-x" title="إغلاق" onClick={(e) => { e.stopPropagation(); void closeTab(id); }}><X /></button>
            </div>
          );
        })}
        <button className="ss-tab-add" title="فاتورة جديدة (F3)" onClick={newTab}><Plus /> فاتورة أخرى</button>
      </div>
      {tabs.map((id) => (
        <SaleTab
          key={id}
          tabId={id}
          active={id === cur}
          onSummary={(s) => setSums((m) => (m[id]?.count === s.count && m[id]?.total === s.total && m[id]?.party === s.party ? m : { ...m, [id]: s }))}
          onSaved={() => {
            if (tabs.length > 1) {
              void closeTab(id, false);
              return true;
            }
            return false;
          }}
        />
      ))}
    </>
  );
}

function SaleTab({ tabId, active, onSummary, onSaved }: { tabId: string; active: boolean; onSummary: (s: TabSummary) => void; onSaved: () => boolean }) {
  const ui = useUi();
  const nav = useNavigate();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);

  const items = useLiveQuery(async () => (await db.items.toArray()).filter((i) => i.active !== false), []) ?? [];
  const units = useLiveQuery(() => db.item_units.toArray(), []) ?? [];
  const customers = useLiveQuery(async () => (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.active !== false), []) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false && (!session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id))), []) ?? [];
  const boxes = useLiveQuery(
    async () =>
      (await db.cashboxes.toArray())
        .filter((c) => c.active !== false && (!session.user.cashbox_ids || session.user.cashbox_ids.includes(c.id)))
        .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'cash' ? -1 : 1)),
    [],
  ) ?? [];
  const myShift = useLiveQuery(async () => (await db.cashier_shifts.where('user_id').equals(session.user.id).toArray()).find((s) => s.status === 'open' && !s._sync) ?? null, []);

  const [whId, setWhId] = useState('');
  const wh = whId || warehouses[0]?.id;
  const stock = useLiveQuery(async () => (wh ? new Map((await db.stock_balances.where('warehouse_id').equals(wh).toArray()).map((b) => [b.item_id, b.qty])) : new Map()), [wh]) ?? new Map();
  // سعر الشراء عند الإشارة للصنف (لمن لديه صلاحية رؤية التكلفة فقط)
  const showCost = can('costs.view');
  const costs = useCostMap(wh, showCost && active);
  const hover = useHoverCard();
  const costHover = (id: string, unit?: string) => (showCost ? hover.bind(<CostCard c={costs.get(id)} unit={unit} />) : {});
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [draft] = useState(() => loadDraft(tabId));
  const [date, setDate] = useState(draft.date ?? todayISO());
  const [partyId, setPartyId] = useState(draft.partyId ?? 'party-cash-customer');
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [lines, setLines] = useState<Line[]>(draft.lines ?? []);
  const [discount, setDiscount] = useState(draft.discount ?? 0);
  const [method, setMethod] = useState<string>(draft.method ?? ''); // id خزينة أو 'credit'
  const [paidText, setPaidText] = useState<string>(draft.paidText ?? '');
  const [printAfter, setPrintAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [newParty, setNewParty] = useState(false);

  // سطر الإدخال
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [entryItem, setEntryItem] = useState<string | null>(null);
  const [entryQty, setEntryQty] = useState(1000);
  const [entryPrice, setEntryPrice] = useState(0);
  const [entryUnit, setEntryUnit] = useState<{ name: string; factor: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);

  const party = customers.find((p) => p.id === partyId);
  const priceList = party?.price_list_id ?? 'pl-retail';
  const box = method && method !== 'credit' ? method : '';
  useEffect(() => {
    if (!method && boxes.length) setMethod(myShift?.cashbox_id && boxes.some((b) => b.id === myShift.cashbox_id) ? myShift.cashbox_id : boxes[0].id);
  }, [boxes, method, myShift]);

  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    if (!listOpen) hover.hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen]);
  const [catFilter, setCatFilter] = useState('');
  const catNames = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);
  const groups = useMemo(() => [...new Set(items.map((i) => (i.category_id ? catNames.get(i.category_id) : undefined)).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ar')), [items, catNames]);
  const matches = useMemo(() => {
    const s = entryItem ? '' : q.trim().toLowerCase();
    return items
      .filter((i) => (!catFilter || i.category_id === catFilter) && (!s || [i.name, i.code, i.barcode].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      .slice(0, 300);
  }, [q, items, catFilter, catNames, entryItem]);

  const pick = async (itemId: string, unitName?: string) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    const u = unitName ? units.find((x) => x.item_id === itemId && x.name === unitName) : null;
    const unit = u ? { name: u.name, factor: u.factor, sale_price: u.sale_price, wholesale_price: u.wholesale_price } : { name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price };
    setEntryItem(itemId);
    setListOpen(false);
    setQ(it.name);
    setEntryQty(1000);
    setEntryPrice(await priceFor(it, unit, priceList));
    setEntryUnit(unit);
    setTimeout(() => { const el = qtyRef.current?.querySelector('input'); el?.focus(); el?.select(); }, 30);
  };
  const addEntry = () => {
    const it = entryItem ? itemMap.get(entryItem) : null;
    if (!it || entryQty <= 0) return;
    const unit = entryUnit ?? { name: it.base_unit, factor: 1000 };
    setLines((ls) => {
      const same = ls.find((l) => l.item_id === it.id && l.unit_name === unit.name && l.price === entryPrice);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: l.qty + entryQty } : l));
      return [...ls, { id: uuid(), item_id: it.id, unit_name: unit.name, unit_factor: unit.factor, qty: entryQty, price: entryPrice, discount: 0, tax_rate_bp: it.tax_rate_bp ?? 0 }];
    });
    setEntryItem(null);
    setEntryUnit(null);
    setQ('');
    setEntryQty(1000);
    setEntryPrice(0);
    setTimeout(() => searchRef.current?.focus(), 20);
  };

  const onSearchKey = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const code = q.trim();
      if (!code || entryItem) {
        if (!entryItem && matches[hl]) return pick(matches[hl].id);
        return;
      }
      const unit = await db.item_units.where('barcode').equals(code).first();
      if (unit) return pick(unit.item_id, unit.name);
      const exact = (await db.items.where('barcode').equals(code).first()) ?? (await db.items.where('code').equals(code).first());
      if (exact) return pick(exact.id);
      if (matches[hl]) return pick(matches[hl].id);
      ui.toast('لا يوجد صنف بهذا الاسم أو الكود', 'err');
    }
  };

  const calc = useMemo(() => {
    try {
      return computeDocument(lines.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp })), discount);
    } catch (e) {
      return { error: (e as Error).message, total: 0, gross: 0, tax: 0, discount: 0, lines: [] } as any;
    }
  }, [lines, discount]);
  const total = calc.total ?? 0;
  let paid = total;
  if (method === 'credit') paid = 0;
  else if (paidText.trim()) {
    try {
      paid = Math.min(parseMoney(paidText), total);
    } catch {
      paid = total;
    }
  }
  const remaining = total - paid;
  const isCash = partyId === 'party-cash-customer';
  const partyName = partyId === 'party-cash-customer' ? null : party?.name ?? null;
  useEffect(() => {
    storeSet(draftKey(tabId), lines.length || partyId !== 'party-cash-customer' || notes ? { date, partyId, notes, lines, discount, method, paidText } : null);
    onSummary({ count: lines.length, total, party: partyName });
  }, [date, partyId, notes, lines, discount, method, paidText, total, partyName]);
  useEffect(() => {
    if (active) setTimeout(() => searchRef.current?.focus(), 30);
  }, [active]);
  const entryAvail = entryItem ? mulDiv(stock.get(entryItem) ?? 0, 1000, entryUnit?.factor ?? 1000) : null;

  const reset = () => {
    setLines([]);
    setDiscount(0);
    setNotes('');
    setPaidText('');
    setPartyId('party-cash-customer');
    setMethod(boxes[0]?.id ?? '');
    setErr(null);
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const save = async (andNew: boolean) => {
    setErr(null);
    if (!lines.length) return setErr('أضف صنفًا واحدًا على الأقل');
    if (calc.error) return setErr(calc.error);
    if (remaining > 0 && isCash) return setErr('المبلغ المتبقي آجل: اختر العميل الذي سيُسجل عليه (أو أضف عميلًا جديدًا)');
    if (method !== 'credit' && !box) return setErr('اختر طريقة الدفع');
    setBusy(true);
    try {
      const id = uuid();
      const doc: DocInput = {
        id,
        doc_type: 'sale_invoice',
        date,
        party_id: partyId,
        warehouse_id: wh,
        cashbox_id: box || null,
        price_list_id: priceList,
        payment_type: remaining > 0 ? 'credit' : 'cash',
        payments: paid > 0 && box ? [{ id: uuid(), cashbox_id: box, amount: paid }] : [],
        instruments: [],
        charges: [],
        shift_id: myShift && box === myShift.cashbox_id ? myShift.id : null,
        lines: lines.map((l) => ({ ...l, serials: [], expiry: null, ref_line_id: null, notes: null })),
        journal_lines: [],
        paid: 0,
        amount: 0,
        discount,
        notes: notes || null,
        reserve: false,
        deliver_later: false,
        retained_bp: 0,
      } as DocInput;
      await saveDocument(doc, 'post', null);
      ui.toast(`تم حفظ الفاتورة${remaining > 0 ? ` — آجل ${formatMoney(remaining)} على ${party?.name}` : ''}`);
      if (printAfter) window.open(`/print/${id}?auto=1`, '_blank');
      if (andNew) {
        if (!onSaved()) reset();
      }
      else nav(`/docs/view/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault();
        void save(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        void save(false);
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const unitOptions = (itemId: string) => {
    const it = itemMap.get(itemId);
    if (!it) return [];
    return [{ name: it.base_unit, factor: 1000 }, ...units.filter((u) => u.item_id === itemId && u.active !== false)];
  };
  const priceLocked = !can('sales.price_change');

  return (
    <div className="ss" style={active ? undefined : { display: 'none' }}>
      {/* ======= الشريط العلوي: الإدخال + الإجمالي ======= */}
      <CategoryFilter value={catFilter} onChange={(id) => { setCatFilter(id); setHl(0); searchRef.current?.focus(); }} />
      <div className="ss-top">
        <div className="ss-entry">
          <div className="ss-step" style={{ flex: 3 }}>
            <label><b>1</b> ابحث عن الصنف</label>
            <div className="picker">
              <input
                ref={searchRef}
                className="input"
                autoFocus
                value={q}
                placeholder="الاسم أو الكود أو امسح الباركود (F2)"
                onChange={(e) => {
                  setQ(e.target.value);
                  setHl(0);
                  setEntryItem(null);
                  setListOpen(true);
                }}
                onFocus={(e) => {
                  setListOpen(true);
                  e.target.select();
                }}
                onBlur={() => setTimeout(() => setListOpen(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setListOpen(false);
                  else void onSearchKey(e);
                }}
              />
              {listOpen && (!entryItem || !q) && (
                <FloatingPop anchor={searchRef} maxHeight={460} minWidth={440}>
                  <GroupChips groups={groups} value={catNames.get(catFilter) ?? ''} onChange={(g) => { setCatFilter(cats.find((c) => c.name === g)?.id ?? ''); setHl(0); }} />
                  {matches.length === 0 && <div className="picker-opt muted">لا توجد أصناف مطابقة</div>}
                  {matches.map((m, i) => (
                    <div
                      key={m.id}
                      className={`picker-opt ${i === hl ? 'hl' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); hover.hide(); void pick(m.id); }}
                      onMouseEnter={(e) => { setHl(i); (costHover(m.id, m.base_unit) as any).onMouseEnter?.(e); }}
                      onMouseLeave={() => hover.hide()}
                    >
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span className="muted small num">{m.is_service ? 'خدمة' : `متاح ${formatQty(stock.get(m.id) ?? 0)}`} · {formatMoney(m.sale_price)}</span>
                    </div>
                  ))}
                </FloatingPop>
              )}
            </div>
          </div>
          <div className="ss-step ss-avail">
            <label>المتاح</label>
            <div className={`ss-avail-v num ${entryAvail !== null && entryAvail <= 0 ? 'red' : ''}`} {...(entryItem ? costHover(entryItem, itemMap.get(entryItem)?.base_unit) : {})}>{entryAvail === null ? '—' : itemMap.get(entryItem!)?.is_service ? 'خدمة' : formatQty(entryAvail)}</div>
          </div>
          <div className="ss-step" ref={qtyRef} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), priceLocked ? addEntry() : (priceRef.current?.querySelector('input')?.focus(), priceRef.current?.querySelector('input')?.select()))}>
            <label><b>2</b> الكمية</label>
            <QtyInput value={entryQty} onChange={setEntryQty} />
          </div>
          <div className="ss-step" ref={priceRef} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEntry())}>
            <label><b>3</b> سعر البيع</label>
            <MoneyInput value={entryPrice} onChange={setEntryPrice} disabled={priceLocked} />
          </div>
          <div className="ss-step" style={{ flex: 'none' }}>
            <label><b>4</b> أضف</label>
            <button className="btn success primary ss-add" disabled={!entryItem} onClick={addEntry} aria-label="أضف"><Check /></button>
          </div>
        </div>
        <div className="ss-total">
          <div className="ss-total-label">الإجمالي</div>
          <div className="ss-total-v num">{formatMoney(total)}</div>
          <div className="ss-total-sub">{lines.length} صنف{calc.tax ? ` · ضريبة ${formatMoney(calc.tax)}` : ''}</div>
        </div>
      </div>

      <div className="ss-body">
        {/* ======= جدول الأصناف ======= */}
        <div className="ss-grid card">
          <table className="table">
            <thead>
              <tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>المتاح</th><th className="n">الكمية</th><th className="n">السعر</th>{can('sales.discount') && <th className="n">الخصم</th>}<th className="n">الإجمالي</th><th /></tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 50 }} className="muted">ابدأ بالبحث عن صنف بالاسم أو بالكود أو امسح الباركود</td></tr>
              )}
              {lines.map((l, i) => {
                const it = itemMap.get(l.item_id);
                const avail = mulDiv(stock.get(l.item_id) ?? 0, 1000, l.unit_factor);
                const short = it && !it.is_service && toBaseQty(l.qty, l.unit_factor) > (stock.get(l.item_id) ?? 0);
                const upd = (p: Partial<Line>) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...p } : x)));
                const uopts = unitOptions(l.item_id);
                return (
                  <tr key={l.id}>
                    <td className="muted">{i + 1}</td>
                    <td className="bold"><span className="hc-target" {...costHover(l.item_id, it?.base_unit)}>{it?.name}</span></td>
                    <td>
                      {uopts.length > 1 ? (
                        <select className="select" style={{ height: 36, minWidth: 90 }} value={l.unit_name} onChange={async (e) => {
                          const u: any = uopts.find((x: any) => x.name === e.target.value);
                          upd({ unit_name: u.name, unit_factor: u.factor, price: await priceFor(it!, u.name === it!.base_unit ? { name: u.name, factor: 1000, sale_price: it!.sale_price, wholesale_price: it!.wholesale_price } : u, priceList) });
                        }}>
                          {uopts.map((u: any) => <option key={u.name} value={u.name}>{u.name}</option>)}
                        </select>
                      ) : l.unit_name}
                    </td>
                    <td>{it?.is_service ? <span className="muted small">خدمة</span> : <span className={`stock-chip ${avail <= 0 ? 'out' : short ? 'low' : ''}`} style={{ marginTop: 0 }}>{formatQty(avail)}</span>}</td>
                    <td className="n" style={{ width: 110 }}><QtyInput value={l.qty} onChange={(v) => upd({ qty: v })} /></td>
                    <td className="n" style={{ width: 120 }}><MoneyInput value={l.price} onChange={(v) => upd({ price: v })} disabled={priceLocked} /></td>
                    {can('sales.discount') && <td className="n" style={{ width: 110 }}><MoneyInput value={l.discount} onChange={(v) => upd({ discount: v })} /></td>}
                    <td className="n bold">{formatMoney(calc.lines?.[i]?.total ?? 0)}</td>
                    <td><button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="حذف"><Trash2 /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {can('items.create') && <button className="btn plain" style={{ margin: 10 }} onClick={() => setNewItem(true)}><Plus /> صنف جديد غير موجود</button>}
        </div>

        {/* ======= العميل والدفع والحفظ ======= */}
        <div className="ss-side">
          <div className="card pad stack" style={{ gap: 12 }}>
            <div>
              <CustomerFields partyId={partyId} onChange={setPartyId} />
              {!isCash && party && <div className="caption" style={{ marginTop: 6 }}>رصيده الحالي <span className="num">{formatMoney(party.balance ?? 0)}</span> — الفاتورة تُحفظ في سجله</div>}
            </div>

            <div className="field">
              <label>طريقة الدفع</label>
              <div className="ss-pay">
                {boxes.map((b) => (
                  <button key={b.id} className={method === b.id ? 'on' : ''} onClick={() => { setMethod(b.id); setPaidText(''); }}>
                    {b.kind === 'bank' ? <CreditCard /> : <Banknote />}<span>{b.name}</span>
                  </button>
                ))}
                {can('sales.credit') && (
                  <button className={`credit ${method === 'credit' ? 'on' : ''}`} onClick={() => setMethod('credit')}><Clock3 /><span>آجل</span></button>
                )}
              </div>
            </div>

            {method !== 'credit' && can('sales.credit') && (
              <div className="field">
                <label>المدفوع الآن</label>
                <input className="input num" inputMode="decimal" placeholder={formatMoney(total)} value={paidText} onChange={(e) => setPaidText(e.target.value)} />
                <div className="caption">اتركه فارغًا لو الدفع كامل. لو أقل، الباقي يُسجل آجل على العميل.</div>
              </div>
            )}

            {(method === 'credit' || remaining > 0) && isCash && (
              <Banner kind="warn">
                البيع الآجل يُسجل على عميل. اختر العميل من الأعلى أو{' '}
                <button className="btn sm" onClick={() => setNewParty(true)}><UserPlus /> أضف عميل جديد</button>
              </Banner>
            )}

            <div className="ss-sum">
              <div className="row"><span>الإجمالي قبل الخصم</span><b className="num">{formatMoney(calc.gross ?? 0)}</b></div>
              {can('sales.discount') && (
                <div className="row"><span>خصم على الفاتورة</span><div style={{ width: 120 }}><MoneyInput value={discount} onChange={setDiscount} /></div></div>
              )}
              {calc.tax > 0 && <div className="row"><span>الضريبة</span><b className="num">{formatMoney(calc.tax)}</b></div>}
              <div className="row big"><span>الإجمالي</span><b className="num">{formatMoney(total)}</b></div>
              <div className="row"><span>المدفوع</span><b className="num green">{formatMoney(paid)}</b></div>
              {remaining > 0 && <div className="row"><span>آجل على العميل</span><b className="num orange">{formatMoney(remaining)}</b></div>}
            </div>

            {err && <Banner kind="err">{err}</Banner>}
            <button className="btn primary xl block" disabled={busy || !lines.length} onClick={() => save(true)}><Check /> حفظ وفاتورة جديدة <small style={{ opacity: .8 }}>F12</small></button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn block" disabled={busy || !lines.length} onClick={() => save(false)}>حفظ وعرض <small className="muted">F9</small></button>
              <label className="btn" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} /> <Printer /> طباعة
              </label>
            </div>
            {lines.length > 0 && <button className="btn plain danger" onClick={reset}><X /> تفريغ الفاتورة</button>}
          </div>

          <div className="card pad stack" style={{ gap: 10 }}>
            <div className="grid grid-2">
              <div className="field"><label>التاريخ</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              {warehouses.length > 1 ? (
                <div className="field"><label>المخزن</label>
                  <select className="select" value={wh} onChange={(e) => setWhId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                </div>
              ) : <div />}
            </div>
            <div className="field"><label>ملاحظات</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <button className="btn plain" onClick={() => nav('/docs/new/sale_invoice?advanced=1')}><Settings2 /> فاتورة متقدمة (أقساط، شيكات، تسليم لاحق، مندوب…)</button>
          </div>
        </div>
      </div>

      {active && hover.node}
      {newItem && <QuickItemSheet onClose={() => setNewItem(false)} onSaved={(id) => setTimeout(() => void pick(id), 80)} />}
      {newParty && <QuickPartySheet onClose={() => setNewParty(false)} onSaved={(id) => setPartyId(id)} />}
    </div>
  );
}
