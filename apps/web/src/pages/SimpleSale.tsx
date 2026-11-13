import { computeDocument, formatMoney, formatQty, hasPermission, mulDiv, parseMoney, todayISO, toBaseQty, uuid, type DocInput } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsRight, Clock3, CreditCard, FileSpreadsheet, Hash, Info, Minus, Percent, Pin, PinOff, Plus, Printer, Search, Settings2, Share2, Tag, Trash2, UserPlus, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QuickItemSheet } from '../components/QuickItem';
import { QuickPartySheet } from '../components/QuickParty';
import { CustomerFields } from '../components/CustomerFields';
import { CategoryFilter } from '../components/Categories';
import { Banner, FloatingPop, GroupChips, MoneyInput, Picker, QtyInput, Sheet, Switch, exportExcel, useUi } from '../components/ui';
import { priceFor, saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession, useSettings, userCashboxes } from '../lib/hooks';
import { useCostMap } from '../lib/costs';
import { CostCard, useHoverCard } from '../components/HoverCard';
import { searchItems } from '../lib/search';

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
  whId?: string;
  notes?: string;
  lines?: Line[];
  discount?: number;
  discMode?: 'amt' | 'pct';
  discPct?: string;
  addName?: string;
  addAmt?: number;
  roundOn?: boolean;
  plOverride?: string | null;
  method?: string;
  paidText?: string;
  restMethod?: string;
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
export function SimpleSalePage({ kind = 'sale' }: { kind?: 'sale' | 'purchase' }) {
  const nav = useNavigate();
  const loc = useLocation();
  const P = kind === 'purchase';
  const title = P ? 'فاتورة شراء' : 'فاتورة بيع';
  const tabParam = P ? 'purchaseTab' : 'saleTab';
  // فاتورة الشراء لها مسودتها المستقلة (لا تختلط بمسودة البيع)
  const defaultId = P ? 'p-default' : 'default';
  const tabId = new URLSearchParams(loc.search).get(tabParam) || defaultId;
  // ترحيل لمرة واحدة: مسودة من نظام التبويبات القديم داخل الصفحة تنتقل للتبويب الافتراضي
  useState(() => {
    const legacyKey = P ? 'purchase-tabs' : 'sale-tabs';
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyKey) ?? '[]');
      if (Array.isArray(legacy) && !localStorage.getItem(draftKey(defaultId))) {
        const withDraft = legacy.find((id) => typeof id === 'string' && localStorage.getItem(draftKey(id)));
        if (withDraft) {
          localStorage.setItem(draftKey(defaultId), localStorage.getItem(draftKey(withDraft))!);
          localStorage.removeItem(draftKey(withDraft));
        }
      }
      localStorage.removeItem(legacyKey);
    } catch {
      /* التخزين غير متاح */
    }
    return null;
  });
  const newTab = () => nav(`${loc.pathname}?${tabParam}=${encodeURIComponent(uuid())}`);

  useEffect(() => {
    document.title = `${title}${tabId === defaultId ? '' : ` · ${tabId.slice(-4)}`} — الحسابات`;
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = title;
  }, [title, tabId]);

  return (
    <SaleTab kind={kind} key={tabId} tabId={tabId} active onNewTab={newTab} />
  );
}

/** إعدادات افتراضية مثبتة لكل مستخدم (طريقة الدفع وقائمة الأسعار) */
const defaultsKey = (uid: string) => `erp.sale.defaults.${uid}`;
function loadDefaults(uid: string): { method?: string; priceList?: string } {
  try {
    return JSON.parse(localStorage.getItem(defaultsKey(uid)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** عرض أعمدة جدول الفاتورة لكل مستخدم (سحب حافة العنوان، دبل كليك للملاءمة) */
const COLS = ['code', 'name', 'unit', 'avail', 'qty', 'price', 'gross', 'disc', 'net', 'del'] as const;
const DEFAULT_W: Record<string, number> = { code: 70, name: 260, unit: 84, avail: 74, qty: 96, price: 104, gross: 100, disc: 96, net: 104, del: 44 };
function useColWidths(uid: string) {
  const key = `erp.sale.cols.${uid}`;
  const [w, setW] = useState<Record<string, number>>(() => {
    try {
      return { ...DEFAULT_W, ...(JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}) };
    } catch {
      return { ...DEFAULT_W };
    }
  });
  const save = (n: Record<string, number>) => {
    setW(n);
    try {
      localStorage.setItem(key, JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  return { w, set: (c: string, v: number) => save({ ...w, [c]: Math.max(44, Math.min(700, Math.round(v))) }), reset: () => save({ ...DEFAULT_W }) };
}

function SaleTab({ kind, tabId, active, onNewTab }: { kind: 'sale' | 'purchase'; tabId: string; active: boolean; onNewTab: () => void }) {
  const P = kind === 'purchase';
  const title = P ? 'فاتورة شراء' : 'فاتورة بيع';
  const ui = useUi();
  const nav = useNavigate();
  const { session } = useSession();
  const uid = session.user.id;
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const dk = P ? `p.${uid}` : uid; // إعدادات الشراء منفصلة عن البيع
  const canCredit = P || can('sales.credit');
  const settings = useSettings();
  const [draft] = useState(() => loadDraft(tabId) as Draft);

  const items = useLiveQuery(async () => (await db.items.toArray()).filter((i) => i.active !== false), []) ?? [];
  const units = useLiveQuery(() => db.item_units.toArray(), []) ?? [];
  const customers = useLiveQuery(async () => (await db.parties.where('kind').equals(P ? 'supplier' : 'customer').toArray()).filter((p) => p.active !== false), [P]) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false && (!session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id))), []) ?? [];
  const priceLists = useLiveQuery(async () => (await db.price_lists.toArray()).filter((p) => p.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), []) ?? [];
  const boxes = useLiveQuery(
    async () =>
      userCashboxes(session.user),
    [],
  ) ?? [];
  const myShift = useLiveQuery(async () => (await db.cashier_shifts.where('user_id').equals(uid).toArray()).find((s) => s.status === 'open' && !s._sync) ?? null, []);

  const [whId, setWhId] = useState<string>(draft.whId ?? '');
  const wh = whId || warehouses[0]?.id;
  const stock = useLiveQuery(async () => (wh ? new Map((await db.stock_balances.where('warehouse_id').equals(wh).toArray()).map((b) => [b.item_id, b.qty])) : new Map()), [wh]) ?? new Map();
  // سعر الشراء عند الإشارة للصنف (لمن لديه صلاحية رؤية التكلفة فقط)
  const showCost = P || can('costs.view');
  const costs = useCostMap(wh, showCost && active);
  const hover = useHoverCard();
  const costHover = (id: string, unit?: string) => (showCost ? hover.bind(<CostCard c={costs.get(id)} unit={unit} />) : {});
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  useEffect(() => {
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        if (itemMap.get(line.item_id)?.is_service && line.discount !== 0) {
          changed = true;
          return { ...line, discount: 0 };
        }
        return line;
      });
      return changed ? next : current;
    });
  }, [itemMap]);

  const defaults = useMemo(() => loadDefaults(dk), [dk]);
  const [date, setDate] = useState(draft.date ?? todayISO());
  const [partyId, setPartyId] = useState<string>(draft.partyId ?? (P ? '' : 'party-cash-customer'));
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [lines, setLines] = useState<Line[]>(draft.lines ?? []);
  const [discMode, setDiscMode] = useState<'amt' | 'pct'>(draft.discMode ?? 'amt');
  const [discount, setDiscount] = useState<number>(draft.discount ?? 0); // مبلغ
  const [discPct, setDiscPct] = useState<string>(draft.discPct ?? '');
  const [addName, setAddName] = useState<string>(draft.addName === 'مصنعية' || draft.addName === 'رسوم خدمة' ? '' : (draft.addName ?? ''));
  const [addAmt, setAddAmt] = useState<number>(draft.addAmt ?? 0);
  const [roundOn, setRoundOn] = useState<boolean>(draft.roundOn ?? false);
  const [plOverride, setPlOverride] = useState<string | null>(draft.plOverride ?? defaults.priceList ?? null);
  const [method, setMethod] = useState<string>(draft.method ?? defaults.method ?? ''); // id خزينة أو 'credit'
  const [paidText, setPaidText] = useState<string>(draft.paidText ?? '');
  const [restMethod, setRestMethod] = useState<string>(draft.restMethod ?? '');
  const [printAfter, setPrintAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [newParty, setNewParty] = useState(false);
  const [inquiry, setInquiry] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const cols = useColWidths(dk);

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
  const paidRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const party = customers.find((p) => p.id === partyId);
  const priceList = plOverride ?? party?.price_list_id ?? 'pl-retail';
  const box = method && method !== 'credit' ? method : '';
  useEffect(() => {
    if ((!method || (method !== 'credit' && boxes.length && !boxes.some((b) => b.id === method))) && boxes.length)
      setMethod(myShift?.cashbox_id && boxes.some((b) => b.id === myShift.cashbox_id) ? myShift.cashbox_id : boxes[0].id);
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
    const pool = items.filter((i) => !catFilter || i.category_id === catFilter);
    return (entryItem || !q.trim() ? [...pool].sort((a, b) => a.name.localeCompare(b.name, 'ar')) : searchItems(pool, q)).slice(0, 300);
  }, [q, items, catFilter, catNames, entryItem]);

  const unitOf = (it: any, unitName?: string) => {
    const u = unitName ? units.find((x) => x.item_id === it.id && x.name === unitName) : null;
    return u ? { name: u.name, factor: u.factor, sale_price: u.sale_price, wholesale_price: u.wholesale_price } : { name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price };
  };
  const unitPrice = async (it: any, unit: any) => (P ? mulDiv(costs.get(it.id)?.last ?? costs.get(it.id)?.avg ?? 0, unit.factor ?? 1000, 1000) : priceFor(it, unit, priceList));
  const pick = async (itemId: string, unitName?: string) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    const unit = unitOf(it, unitName);
    setEntryItem(itemId);
    setListOpen(false);
    setQ(it.name);
    setEntryQty(1000);
    setEntryPrice(await unitPrice(it, unit));
    setEntryUnit(unit);
    setTimeout(() => { const el = qtyRef.current?.querySelector('input'); el?.focus(); el?.select(); }, 30);
  };
  const addEntry = () => {
    const it = entryItem ? itemMap.get(entryItem) : null;
    if (!it || entryQty <= 0) return;
    const unit = entryUnit ?? { name: it.base_unit, factor: 1000 };
    if (!P && !it.is_service && !settings.allow_negative_stock) {
      const used = lines.filter((l) => l.item_id === it.id).reduce((a, l) => a + toBaseQty(l.qty, l.unit_factor), 0);
      const have = stock.get(it.id) ?? 0;
      if (used + toBaseQty(entryQty, unit.factor) > have) {
        ui.toast(have - used > 0 ? `الرصيد غير كافٍ: المتاح من «${it.name}» ${formatQty(have - used)} فقط` : `«${it.name}» غير متوفر في المخزن (الرصيد صفر)`, 'err');
        return;
      }
    }
    let idx = -1;
    setLines((ls) => {
      const same = ls.findIndex((l) => l.item_id === it.id && l.unit_name === unit.name && l.price === entryPrice);
      if (same >= 0) {
        idx = same;
        return ls.map((l, i) => (i === same ? { ...l, qty: l.qty + entryQty } : l));
      }
      idx = ls.length;
      return [...ls, { id: uuid(), item_id: it.id, unit_name: unit.name, unit_factor: unit.factor, qty: entryQty, price: entryPrice, discount: 0, tax_rate_bp: it.tax_rate_bp ?? 0 }];
    });
    setTimeout(() => setSel(Math.max(0, idx)), 0);
    setEntryItem(null);
    setEntryUnit(null);
    setQ('');
    setEntryQty(1000);
    setEntryPrice(0);
    setTimeout(() => searchRef.current?.focus(), 20);
  };

  // الصنف المحدد بالأسهم يظهر دائمًا داخل القائمة
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hl, listOpen]);

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

  // ---------- الحساب: خصم بالمبلغ أو النسبة، إضافة، وخصم الفكة ----------
  const hasServiceLine = lines.some((line) => itemMap.get(line.item_id)?.is_service);
  const merchandiseNet = lines.reduce((sum, line) => {
    if (itemMap.get(line.item_id)?.is_service) return sum;
    return sum + Math.max(0, mulDiv(line.qty, line.price, 1000) - (line.discount ?? 0));
  }, 0);
  const allocatedLineDiscounts = (docDiscount: number) => {
    const out = lines.map((line) => line.discount ?? 0);
    if (!hasServiceLine || docDiscount <= 0) return out;
    if (docDiscount > merchandiseNet) throw new Error('خصم الفاتورة أكبر من صافي الأصناف المخزنية');
    const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => !itemMap.get(line.item_id)?.is_service);
    const last = eligible[eligible.length - 1]?.index ?? -1;
    let remaining = docDiscount;
    for (const { line, index } of eligible) {
      const net = Math.max(0, mulDiv(line.qty, line.price, 1000) - (line.discount ?? 0));
      const share = index === last ? remaining : Math.min(mulDiv(docDiscount, net, merchandiseNet), net, remaining);
      out[index] += share;
      remaining -= share;
    }
    return out;
  };
  const compute = (disc: number) => {
    try {
      const discounts = allocatedLineDiscounts(disc);
      return computeDocument(lines.map((l, index) => ({ qty: l.qty, price: l.price, discount: discounts[index], tax_rate_bp: l.tax_rate_bp })), hasServiceLine ? 0 : disc);
    } catch (e) {
      return { error: (e as Error).message, total: 0, gross: 0, tax: 0, discount: 0, lines: [] } as any;
    }
  };
  const lineDisc = lines.reduce((s, l) => s + (l.discount ?? 0), 0);
  const base = compute(0);
  let pct = 0;
  try {
    pct = discPct.trim() ? Math.max(0, Math.min(100, parseFloat(discPct.replace(',', '.')) || 0)) : 0;
  } catch {
    pct = 0;
  }
  const docDisc = discMode === 'pct' ? Math.round(Math.max(0, merchandiseNet) * pct / 100) : discount;
  const addOn = addName && addAmt > 0 ? addAmt : 0;
  let finalDisc = docDisc;
  let calc = compute(finalDisc);
  let roundOff = 0;
  if (roundOn && !calc.error) {
    for (let k = 0; k < 3; k++) {
      const r = (calc.total + addOn) % 100;
      if (r <= 0) break;
      roundOff += r;
      finalDisc = docDisc + roundOff;
      calc = compute(finalDisc);
    }
  }
  const total = (calc.total ?? 0) + addOn;
  let paid = total;
  if (method === 'credit') paid = 0;
  else if (paidText.trim()) {
    try {
      paid = Math.min(parseMoney(paidText), total);
    } catch {
      paid = total;
    }
  }
  const remainder = total - paid;
  const restBox = boxes.find((b) => b.id === restMethod && b.id !== box);
  const credit = method === 'credit' ? total : remainder > 0 && !restBox ? remainder : 0;
  const isCash = partyId === 'party-cash-customer';
  const partyName = partyId === 'party-cash-customer' ? null : party?.name ?? null;
  useEffect(() => {
    storeSet(
      draftKey(tabId),
      lines.length || (partyId && partyId !== 'party-cash-customer') || notes || whId
        ? { date, partyId, whId, notes, lines, discount, discMode, discPct, addName, addAmt, roundOn, plOverride, method, paidText, restMethod }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partyId, whId, notes, lines, discount, discMode, discPct, addName, addAmt, roundOn, plOverride, method, paidText, restMethod]);
  useEffect(() => {
    if (active) setTimeout(() => searchRef.current?.focus(), 30);
  }, [active]);
  useEffect(() => {
    if (sel > lines.length - 1) setSel(Math.max(0, lines.length - 1));
  }, [lines.length, sel]);
  const entryAvail = entryItem ? mulDiv(stock.get(entryItem) ?? 0, 1000, entryUnit?.factor ?? 1000) : null;

  const reset = () => {
    setLines([]);
    setDiscount(0);
    setDiscPct('');
    setAddName('');
    setAddAmt(0);
    setRoundOn(false);
    setNotes('');
    setPaidText('');
    setRestMethod('');
    setPartyId(P ? '' : 'party-cash-customer');
    setPlOverride(loadDefaults(dk).priceList ?? null);
    setMethod(loadDefaults(dk).method ?? boxes[0]?.id ?? '');
    setErr(null);
    setSel(0);
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  // ---------- تثبيت الافتراضيات لكل مستخدم ----------
  const pinned = loadDefaults(dk);
  const pin = (k: 'method' | 'priceList', v: string | null) => {
    const d = { ...loadDefaults(dk) };
    if (v && d[k] !== v) d[k] = v;
    else delete d[k];
    storeSet(defaultsKey(dk), d);
    ui.toast(d[k] ? 'تم التثبيت كافتراضي لك' : 'أُلغي التثبيت');
    setNow(new Date());
  };

  // تغيير قائمة الأسعار يعيد تسعير السطور
  const changePriceList = async (pl: string | null) => {
    setPlOverride(pl);
    const target = pl ?? party?.price_list_id ?? 'pl-retail';
    const next = await Promise.all(
      lines.map(async (l) => {
        const it = itemMap.get(l.item_id);
        if (!it) return l;
        const u = l.unit_name === it.base_unit ? { name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price } : unitOf(it, l.unit_name);
        return { ...l, price: await priceFor(it, u, target) };
      }),
    );
    setLines(next);
  };

  const save = async (mode: 'new' | 'view' | 'print') => {
    setErr(null);
    if ((mode === 'print' || printAfter) && !can(P ? 'purchases.print' : 'sales.print')) return setErr('لا تملك صلاحية طباعة الفاتورة');
    if (!lines.length) return setErr('أضف صنفًا واحدًا على الأقل');
    if (calc.error) return setErr(calc.error);
    if (!P && !settings.allow_negative_stock) {
      const need = new Map<string, number>();
      for (const l of lines) if (!itemMap.get(l.item_id)?.is_service) need.set(l.item_id, (need.get(l.item_id) ?? 0) + toBaseQty(l.qty, l.unit_factor));
      const short = [...need].filter(([id, q]) => q > (stock.get(id) ?? 0)).map(([id]) => `«${itemMap.get(id)?.name}» (المتاح ${formatQty(stock.get(id) ?? 0)})`);
      if (short.length) return setErr(`الرصيد غير كافٍ في المخزن: ${short.join('، ')}. عدّل الكمية أو احذف الصنف، أو أضف رصيدًا بفاتورة شراء أولًا.`);
    }
    if (P && !partyId) return setErr('اختر المورد');
    if (credit > 0 && isCash) return setErr('الجزء الآجل يُسجل على عميل: اختر العميل (أو أضف عميلًا جديدًا)');
    if (credit > 0 && !canCredit) return setErr('لا تملك صلاحية البيع الآجل؛ اختر طريقة لدفع الباقي');
    if (method !== 'credit' && !box) return setErr('اختر طريقة الدفع');
    setBusy(true);
    try {
      const id = uuid();
      const savedLineDiscounts = allocatedLineDiscounts(finalDisc);
      const payments = [
        ...(paid > 0 && box ? [{ id: uuid(), cashbox_id: box, amount: paid }] : []),
        ...(remainder > 0 && restBox && method !== 'credit' ? [{ id: uuid(), cashbox_id: restBox.id, amount: remainder }] : []),
      ];
      const doc: DocInput = {
        id,
        doc_type: P ? 'purchase_invoice' : 'sale_invoice',
        date,
        party_id: partyId,
        warehouse_id: wh,
        cashbox_id: box || null,
        price_list_id: P ? null : priceList,
        payment_type: credit > 0 ? 'credit' : 'cash',
        payments,
        instruments: [],
        charges: addOn > 0 ? [{ id: uuid(), name: addName, mode: 'add', amount: addOn }] : [],
        shift_id: !P && myShift && payments.some((p) => p.cashbox_id === myShift.cashbox_id) ? myShift.id : null,
        lines: lines.map((l, i) => ({ ...l, discount: savedLineDiscounts[i], serials: [], expiry: null, ref_line_id: null, notes: null })),
        journal_lines: [],
        paid: 0,
        amount: 0,
        discount: hasServiceLine ? 0 : finalDisc,
        notes: notes || null,
        reserve: false,
        deliver_later: false,
        retained_bp: 0,
      } as DocInput;
      await saveDocument(doc, 'post', null);
      ui.toast(`تم حفظ الفاتورة${credit > 0 ? ` — آجل ${formatMoney(credit)} على ${party?.name}` : ''}`);
      if (printAfter || mode === 'print') window.open(`/print/${id}?auto=1`, '_blank');
      // الفاتورة اتحفظت: امسح المسودة دائمًا حتى لا تعود أصنافها عند الرجوع للشاشة
      reset();
      storeSet(draftKey(tabId), null);
      if (mode === 'view') nav(`/docs/view/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---------- أوامر السطر المحدد ----------
  const focusCell = (field: 'qty' | 'price' | 'disc') => {
    const l = lines[sel];
    if (!l) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${l.id}-${field}"] input`);
    el?.focus();
    el?.select();
  };
  const deleteSel = async () => {
    const l = lines[sel];
    if (!l) return;
    const ok = await ui.confirm({ title: 'حذف السطر؟', message: `سيُحذف «${itemMap.get(l.item_id)?.name ?? ''}» من الفاتورة.`, confirmLabel: 'حذف', destructive: true });
    if (!ok) return;
    setLines((ls) => ls.filter((x) => x.id !== l.id));
  };
  const newInvoice = async () => {
    if (lines.length && !(await ui.confirm({ title: 'فاتورة جديدة؟', message: 'الأصناف الحالية لم تُحفظ وستُمسح من هذه الفاتورة.', confirmLabel: 'فاتورة جديدة', destructive: true }))) return;
    reset();
  };
  const exportLines = () =>
    exportExcel(
      title,
      ['الكود', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي', 'الخصم', 'النهائي'],
      lines.map((l, i) => {
        const it = itemMap.get(l.item_id);
        const g = mulDiv(l.qty, l.price, 1000);
        return [it?.code, it?.name, l.unit_name, formatQty(l.qty), formatMoney(l.price), formatMoney(g), formatMoney(l.discount), formatMoney(calc.lines?.[i]?.total ?? g - l.discount)];
      }),
    );
  const shareInvoice = async () => {
    const text = [`${title} — ${partyName ?? (P ? 'مورد' : 'عميل نقدي')} — ${date}`, ...lines.map((l) => `${itemMap.get(l.item_id)?.name} × ${formatQty(l.qty)} = ${formatMoney(mulDiv(l.qty, l.price, 1000) - l.discount)}`), `الإجمالي: ${formatMoney(total)}`].join('\n');
    try {
      if (navigator.share) await navigator.share({ title, text });
      else {
        await navigator.clipboard.writeText(text);
        ui.toast('نُسخ ملخص الفاتورة');
      }
    } catch {
      /* ألغى المستخدم المشاركة */
    }
  };
  const lastSales = useLiveQuery(async () => {
    const all = (await db.documents.where('doc_type').equals(P ? 'purchase_invoice' : 'sale_invoice').toArray()).filter((d) => d.status !== 'draft');
    all.sort((a, b) => String(a.date + (a.created_at ?? '')).localeCompare(String(b.date + (b.created_at ?? ''))));
    return { first: all[0]?.id ?? null, last: all[all.length - 1]?.id ?? null };
  }, [P]);

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (document.querySelector('.overlay')) return; // نافذة مفتوحة
      const keyMap: Record<string, () => void> = {
        F3: onNewTab,
        F2: () => setInquiry(lines[sel]?.item_id ?? entryItem ?? null),
        F4: () => void save('print'),
        F5: () => focusCell('qty'),
        F6: () => focusCell('price'),
        F7: () => focusCell('disc'),
        F8: () => void deleteSel(),
        F9: () => void save('view'),
        F10: onNewTab,
        F11: () => { paidRef.current?.focus(); paidRef.current?.select(); },
        F12: () => void save('new'),
      };
      if (keyMap[e.key]) {
        e.preventDefault();
        keyMap[e.key]();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void save('new');
        return;
      }
      if (!typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && lines.length) {
        e.preventDefault();
        setSel((s) => Math.max(0, Math.min(lines.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))));
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
  const priceLocked = !P && !can('sales.price_change');
  const canDisc = P || can('sales.discount');
  const sum = lines.reduce(
    (a, l, i) => {
      const g = mulDiv(l.qty, l.price, 1000);
      return { qty: a.qty + l.qty, gross: a.gross + g, disc: a.disc + (l.discount ?? 0), net: a.net + (calc.lines?.[i]?.total ?? g - (l.discount ?? 0)) };
    },
    { qty: 0, gross: 0, disc: 0, net: 0 },
  );

  // ---------- تغيير عرض الأعمدة ----------
  const startResize = (c: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = cols.w[c];
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('col-resizing');
    const move = (ev: PointerEvent) => cols.set(c, startW + (startX - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const fitColumn = (c: string, idx: number) => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;font-weight:700;font-size:15px';
    document.body.appendChild(probe);
    let max = 60;
    gridRef.current?.querySelectorAll('tr').forEach((tr) => {
      const cell = tr.children[idx] as HTMLElement | undefined;
      if (!cell || (cell as HTMLTableCellElement).colSpan > 1) return;
      const input = cell.querySelector('input, select') as HTMLInputElement | null;
      probe.textContent = input ? input.value : cell.textContent ?? '';
      max = Math.max(max, probe.offsetWidth + (input ? 46 : 34));
    });
    probe.remove();
    cols.set(c, max);
  };
  const H = ({ c, idx, children, n }: { c: string; idx: number; children?: ReactNode; n?: boolean }) => (
    <th className={`si-col ${c}${n ? ' n' : ''}`}>
      {children}
      {c !== 'del' && <span className="col-grip" title="اسحب لتغيير العرض · دبل كليك للملاءمة" onPointerDown={startResize(c)} onDoubleClick={() => fitColumn(c, idx)} />}
    </th>
  );

  return (
    <div className="ss si" style={active ? undefined : { display: 'none' }}>
      {/* ======= رقم الفاتورة والتاريخ والوقت + التنقل ======= */}
      <div className="si-page-heading">
        <div>
          <h1>{P ? 'فاتورة شراء جديدة' : 'فاتورة بيع جديدة'}</h1>
          <span>مسودة · تصدر بيانات الفاتورة عند الحفظ</span>
        </div>
        <div className="si-heading-actions">
          <span className={`si-connect ${online ? 'online' : 'offline'}`}><i />{online ? 'متصل' : 'أوفلاين'}</span>
          <button className="btn plain si-new-tab" onClick={onNewTab} title="فتح فاتورة في تبويب مستقل"><Plus /> {P ? 'فاتورة شراء جديدة' : 'فاتورة بيع جديدة'}</button>
        </div>
      </div>
      <div className="si-meta-row">
        <div className="si-meta">
          <div className="si-meta-field si-meta-number"><label>رقم الفاتورة</label><b>يصدر عند الحفظ</b></div>
          <label className="si-meta-field"><span>التاريخ</span><input type="date" className="si-date" aria-label="التاريخ" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="si-meta-field si-meta-party">
            <span>{P ? 'المورد' : 'العميل'}</span>
            {P ? (
              <Picker value={partyId || null} options={customers.map((c) => ({ id: c.id, label: c.name, sub: c.phone ?? c.code, search: `${c.name} ${c.code} ${c.phone ?? ''}` }))} onChange={(id) => setPartyId(id ?? '')} placeholder="ابحث عن المورد بالاسم أو الكود" />
            ) : (
              <CustomerFields partyId={partyId} onChange={setPartyId} layout="row" autoGroupName={credit > 0 ? 'آجل' : (boxes.find((b) => b.id === box)?.kind === 'bank' || restBox?.kind === 'bank') ? 'بنك' : 'نقدي'} />
            )}
          </div>
          <label className="si-meta-field"><span>المخزن</span><select className="si-wh" aria-label="المخزن" value={wh} onChange={(e) => setWhId(e.target.value)} disabled={warehouses.length < 2}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        </div>
        <div className="si-navs" aria-label="التنقل بين الفواتير">
          <button title="بحث في الفواتير" aria-label="بحث في الفواتير" onClick={() => nav(`/invoices?k=${P ? 'purchases' : 'sales'}`)}><Search /></button>
          <button title="أول فاتورة" aria-label="أول فاتورة" disabled={!lastSales?.first} onClick={() => lastSales?.first && nav(`/docs/view/${lastSales.first}`)}><ChevronsRight /></button>
          <button title="آخر فاتورة محفوظة" aria-label="آخر فاتورة محفوظة" disabled={!lastSales?.last} onClick={() => lastSales?.last && nav(`/docs/view/${lastSales.last}`)}><ChevronRight /></button>
        </div>
      </div>

      <div className="si-main">
      {/* ======= بحث الأصناف وجدول البنود في الجهة اليمنى ======= */}
      <div className="ss-top">
        <div className="ss-entry">
          <div className="ss-step" style={{ flex: 3 }}>
            <label><b>1</b> ابحث عن الصنف</label>
            <div className="si-search">
              <div className="picker" style={{ flex: 1 }}>
                <input
                  ref={searchRef}
                  className="input"
                  autoFocus
                  value={q}
                  placeholder="الاسم أو الكود أو امسح الباركود"
                  onChange={(e) => {
                    setQ(e.target.value);
                    setHl(0);
                    setEntryItem(null);
                    setListOpen(true);
                  }}
                  onFocus={(e) => e.target.select()}
                  // القائمة تفتح بالضغط على خانة البحث أو بالكتابة أو بالسهم لأسفل فقط (وليس عند رجوع المؤشر تلقائيًا)
                  onMouseDown={() => setListOpen(true)}
                  onBlur={() => setTimeout(() => setListOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setListOpen(false);
                    else if (!listOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                      e.preventDefault();
                      setListOpen(true);
                    } else if (!listOpen && e.key === 'Enter' && !q.trim()) {
                      e.preventDefault();
                      setListOpen(true);
                    } else void onSearchKey(e);
                  }}
                />
                {listOpen && (!entryItem || !q) && (
                  <FloatingPop anchor={searchRef} maxHeight={460} minWidth={440} className="picker-pop has-head">
                    <GroupChips groups={groups} value={catNames.get(catFilter) ?? ''} onChange={(g) => { setCatFilter(cats.find((c) => c.name === g)?.id ?? ''); setHl(0); }} />
                    <div className="picker-scroll" ref={listRef}>
                    {matches.length === 0 && <div className="picker-opt muted">لا توجد أصناف مطابقة</div>}
                    {matches.map((m, i) => (
                      <div
                        key={m.id}
                        data-i={i}
                        className={`picker-opt ${i === hl ? 'hl' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); hover.hide(); void pick(m.id); }}
                        onMouseEnter={(e) => { setHl(i); (costHover(m.id, m.base_unit) as any).onMouseEnter?.(e); }}
                        onMouseLeave={() => hover.hide()}
                      >
                        <span className="muted small num" style={{ minWidth: 44 }}>{m.code}</span>
                        <span style={{ flex: 1 }}>{m.name}</span>
                        <span className="muted small num">{m.is_service ? 'خدمة' : `متاح ${formatQty(stock.get(m.id) ?? 0)}`} · {formatMoney(m.sale_price)}</span>
                      </div>
                    ))}
                    </div>
                  </FloatingPop>
                )}
              </div>
              <CategoryFilter value={catFilter} onChange={(id) => { setCatFilter(id); setHl(0); searchRef.current?.focus(); }} />
              <button className="btn" title="استعلام عن الصنف (F2)" onClick={() => setInquiry(entryItem ?? lines[sel]?.item_id ?? null)} disabled={!entryItem && !lines[sel]}><Info /> <span className="si-q-l">استعلام</span></button>
            </div>
          </div>
          <div className="ss-step ss-avail">
            <label>المتاح</label>
            <div className={`ss-avail-v num ${entryAvail !== null && entryAvail <= 0 ? 'red' : ''}`} {...(entryItem ? costHover(entryItem, itemMap.get(entryItem)?.base_unit) : {})}>{entryAvail === null ? '—' : itemMap.get(entryItem!)?.is_service ? 'خدمي · بلا مخزون' : formatQty(entryAvail)}</div>
          </div>
          <div className="ss-step" ref={qtyRef} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), priceLocked ? addEntry() : (priceRef.current?.querySelector('input')?.focus(), priceRef.current?.querySelector('input')?.select()))}>
            <label><b>2</b> الكمية</label>
            <QtyInput value={entryQty} onChange={setEntryQty} />
          </div>
          <div className="ss-step" ref={priceRef} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEntry())}>
            <label><b>3</b> {P ? 'سعر الشراء' : 'سعر البيع'}</label>
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
          <div className="ss-total-sub">{lines.length} صنف{finalDisc ? ` · خصم ${formatMoney(finalDisc)}` : ''}{roundOff ? ` (فكة ${formatMoney(roundOff)})` : ''}</div>
        </div>
      </div>
        {/* ======= أوامر السطر المحدد ======= */}
        <div className="si-keys" aria-label="أوامر السطر المحدد">
          <button onClick={() => focusCell('qty')} disabled={!lines[sel]}><Hash />الكمية<kbd>F5</kbd></button>
          <button onClick={() => focusCell('price')} disabled={!lines[sel] || priceLocked}><Tag />السعر<kbd>F6</kbd></button>
          <button onClick={() => focusCell('disc')} disabled={!lines[sel] || !canDisc}><Percent />الخصم<kbd>F7</kbd></button>
          <button className="del" onClick={() => void deleteSel()} disabled={!lines[sel]}><Minus />حذف<kbd>F8</kbd></button>
          <div className="si-ud">
            <button title="السطر السابق" aria-label="السطر السابق" onClick={() => setSel((s) => Math.max(0, s - 1))} disabled={sel <= 0}><ChevronUp /></button>
            <button title="السطر التالي" aria-label="السطر التالي" onClick={() => setSel((s) => Math.min(lines.length - 1, s + 1))} disabled={sel >= lines.length - 1}><ChevronDown /></button>
          </div>
        </div>

        {/* ======= جدول الأصناف ======= */}
        <div className="ss-grid card si-grid" ref={gridRef}>
          <div className="si-tw">
            <table className="table si-table">
              <colgroup>{COLS.map((c) => (c === 'disc' && !canDisc ? null : <col key={c} style={{ width: cols.w[c] }} />))}</colgroup>
              <thead>
                <tr>
                  <H c="code" idx={0}>الكود</H>
                  <H c="name" idx={1}>الصنف</H>
                  <H c="unit" idx={2}>الوحدة</H>
                  <H c="avail" idx={3}>المتاح</H>
                  <H c="qty" idx={4} n>الكمية</H>
                  <H c="price" idx={5} n>السعر</H>
                  <H c="gross" idx={6} n>الإجمالي</H>
                  {canDisc && <H c="disc" idx={7} n>الخصم</H>}
                  <H c="net" idx={canDisc ? 8 : 7} n>النهائي</H>
                  <H c="del" idx={canDisc ? 9 : 8} />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 50 }} className="muted">ابدأ بالبحث عن صنف بالاسم أو بالكود أو امسح الباركود</td></tr>
                )}
                {lines.map((l, i) => {
                  const it = itemMap.get(l.item_id);
                  const avail = mulDiv(stock.get(l.item_id) ?? 0, 1000, l.unit_factor);
                  const short = !P && it && !it.is_service && toBaseQty(l.qty, l.unit_factor) > (stock.get(l.item_id) ?? 0);
                  const upd = (p: Partial<Line>) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...p } : x)));
                  const uopts = unitOptions(l.item_id);
                  const g = mulDiv(l.qty, l.price, 1000);
                  return (
                    <tr key={l.id} className={i === sel ? 'sel' : undefined} onClick={() => setSel(i)} onFocusCapture={() => setSel(i)}>
                      <td className="code num c-code">{it?.code}</td>
                      <td className="bold si-name c-name" title={it?.name}><span className="hc-target" {...costHover(l.item_id, it?.base_unit)}>{it?.name}</span></td>
                      <td className="c-unit" data-label="الوحدة">
                        {uopts.length > 1 ? (
                          <select className="select" style={{ height: 36, width: '100%' }} value={l.unit_name} onChange={async (e) => {
                            const u: any = uopts.find((x: any) => x.name === e.target.value);
                            upd({ unit_name: u.name, unit_factor: u.factor, price: await unitPrice(it!, u.name === it!.base_unit ? { name: u.name, factor: 1000, sale_price: it!.sale_price, wholesale_price: it!.wholesale_price } : u) });
                          }}>
                            {uopts.map((u: any) => <option key={u.name} value={u.name}>{u.name}</option>)}
                          </select>
                        ) : l.unit_name}
                      </td>
                      <td className="c-avail" data-label="المتاح">{it?.is_service ? <span className="muted small" title="صنف خدمي بلا رصيد مخزني">—</span> : <span className={`stock-chip ${avail <= 0 ? 'out' : short ? 'low' : ''}`} style={{ marginTop: 0 }}>{formatQty(avail)}</span>}</td>
                      <td className="n c-qty" data-label="الكمية" data-cell={`${l.id}-qty`}><QtyInput value={l.qty} onChange={(v) => upd({ qty: v })} /></td>
                      <td className="n c-price" data-label="السعر" data-cell={`${l.id}-price`}><MoneyInput value={l.price} onChange={(v) => upd({ price: v })} disabled={priceLocked} /></td>
                      <td className="n num c-gross">{formatMoney(g)}</td>
                      {canDisc && <td className="n c-disc" data-label="الخصم" data-cell={`${l.id}-disc`}>{it?.is_service ? <span className="muted small">غير مطبق</span> : <MoneyInput value={l.discount} onChange={(v) => upd({ discount: v })} />}</td>}
                      <td className="n bold num c-net" data-label="الصافي">{formatMoney(calc.lines?.[i]?.total ?? g - l.discount)}</td>
                      <td className="c-del"><button className="icon-btn" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); setLines((ls) => ls.filter((x) => x.id !== l.id)); }} aria-label="حذف"><Trash2 /></button></td>
                    </tr>
                  );
                })}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4}>الإجماليات <span className="muted small">({lines.length} صنف)</span></td>
                    <td className="n num">{formatQty(sum.qty)}</td>
                    <td />
                    <td className="n num">{formatMoney(sum.gross)}</td>
                    {canDisc && <td className="n num">{formatMoney(sum.disc)}</td>}
                    <td className="n num">{formatMoney(sum.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="si-grid-foot">
            {can('items.create') && <button className="btn plain sm" onClick={() => setNewItem(true)}><Plus /> صنف جديد غير موجود</button>}
            <span className="muted small">اختر سطرًا بالأسهم ↑↓ أو بالضغط عليه، ثم F5 الكمية · F6 السعر · F7 الخصم · F8 حذف. اسحب حافة عنوان أي عمود لتغيير عرضه.</span>
            <button className="btn plain sm" onClick={cols.reset}>المقاسات الأصلية</button>
          </div>
        </div>

        {/* ======= العميل والدفع ======= */}
        <div className="ss-side">
          <div className="card pad stack" style={{ gap: 12 }}>
            <div className="si-summary-title">ملخص الفاتورة</div>
            <div className="ss-sum">
              <div className="row"><span>إجمالي الأصناف</span><b className="num">{formatMoney(calc.gross ?? 0)}</b></div>
              <div className="row"><span>الخصم</span><b className="num">{formatMoney(lineDisc + finalDisc)}</b></div>
              <div className="row"><span>الضريبة</span><b className="num">{formatMoney(calc.tax ?? 0)}</b></div>
              {addOn > 0 && <div className="row"><span>{addName}</span><b className="num">{formatMoney(addOn)}</b></div>}
            </div>
            <div className="si-grand"><span>الإجمالي النهائي</span><b className="num">{formatMoney(total)}</b></div>
            <div className="field">
              <label>طريقة الدفع</label>
              <div className="ss-pay">
                {boxes.map((b) => (
                  <button key={b.id} className={method === b.id ? 'on' : ''} onClick={() => { setMethod(b.id); setPaidText(''); setRestMethod(''); }}>
                    {b.kind === 'bank' ? <CreditCard /> : <Banknote />}<span>{b.name}</span>
                    {pinned.method === b.id && <span className="si-pin" title="مثبتة كافتراضي"><Pin /></span>}
                  </button>
                ))}
                {canCredit && (
                  <button className={`credit ${method === 'credit' ? 'on' : ''}`} onClick={() => setMethod('credit')}>
                    <Clock3 /><span>آجل</span>
                    {pinned.method === 'credit' && <span className="si-pin" title="مثبتة كافتراضي"><Pin /></span>}
                  </button>
                )}
              </div>
              <button className="btn plain sm" style={{ alignSelf: 'flex-start' }} onClick={() => pin('method', method)}>
                {pinned.method === method ? <PinOff /> : <Pin />} {pinned.method === method ? 'إلغاء تثبيت طريقة الدفع' : 'ثبّت هذه الطريقة كافتراضي'}
              </button>
            </div>

            {method !== 'credit' && (
              <div className="field si-paid-field">
                <label htmlFor={`paid-${tabId}`}>المدفوع {box ? `بـ ${boxes.find((b) => b.id === box)?.kind === 'cash' ? 'نقدًا' : boxes.find((b) => b.id === box)?.name}` : ''} <kbd>F11</kbd></label>
                <input id={`paid-${tabId}`} ref={paidRef} className="input num" inputMode="decimal" placeholder={formatMoney(total)} value={paidText} onChange={(e) => setPaidText(e.target.value)} />
                {remainder > 0 && (
                  <div className="si-rest">
                    <div className="pay-line warn"><span>الباقي</span><b className="num">{formatMoney(remainder)}</b></div>
                    <div className="caption">يُدفع الباقي بـ:</div>
                    <div className="si-rest-opts">
                      {boxes.filter((b) => b.id !== box).map((b) => (
                        <button key={b.id} className={restMethod === b.id ? 'on' : ''} onClick={() => setRestMethod(b.id)}>{b.kind === 'bank' ? <CreditCard /> : <Banknote />}{b.name}</button>
                      ))}
                      {canCredit && <button className={!restBox ? 'on' : ''} onClick={() => setRestMethod('')}><Clock3 />آجل</button>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {credit > 0 && isCash && (
              <Banner kind="warn">
                الجزء الآجل يُسجل على عميل. اختر العميل من الأعلى أو{' '}
                <button className="btn sm" onClick={() => setNewParty(true)}><UserPlus /> أضف عميل جديد</button>
              </Banner>
            )}

            <div className="si-pay-sum">
              <div className="row"><span>المدفوع</span><b className="num green">{formatMoney(method === 'credit' ? 0 : total - credit)}</b></div>
              <div className="row"><span>{credit > 0 ? (P ? 'المتبقي (آجل للمورد)' : 'المتبقي (آجل على العميل)') : 'المتبقي'}</span><b className={`num ${credit > 0 ? 'orange' : ''}`}>{formatMoney(credit)}</b></div>
            </div>
            {err && <Banner kind="err">{err}</Banner>}
            <details className="si-more-panel">
              <summary>خصم وإضافات وملاحظات</summary>
              <div className="si-more-panel-content">
                <div className="field"><label>ملاحظات</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <div className="card si-adj">
              <div className="si-adj-g" style={P ? { display: 'none' } : undefined}>
                <label>قائمة الأسعار</label>
                <div className="si-adj-row">
                  <select className="select" value={plOverride ?? ''} onChange={(e) => void changePriceList(e.target.value || null)}>
                    <option value="">حسب العميل ({priceLists.find((p) => p.id === (party?.price_list_id ?? 'pl-retail'))?.name ?? 'قطاعي'})</option>
                    {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className={`icon-btn ${pinned.priceList && pinned.priceList === plOverride ? 'pinned' : ''}`} title="تثبيت قائمة الأسعار كافتراضي" aria-label="تثبيت قائمة الأسعار" disabled={!plOverride} onClick={() => pin('priceList', plOverride)}><Pin /></button>
                </div>
              </div>
              {canDisc && <div className="si-adj-g">
                <label>خصم على الفاتورة</label>
                <div className="si-adj-row">
                  <div className="segmented"><button className={discMode === 'pct' ? 'on' : ''} onClick={() => setDiscMode('pct')}>%</button><button className={discMode === 'amt' ? 'on' : ''} onClick={() => setDiscMode('amt')}>مبلغ</button></div>
                  {discMode === 'pct' ? <input className="input num" inputMode="decimal" aria-label="نسبة الخصم" placeholder="0" value={discPct} onChange={(e) => setDiscPct(e.target.value)} /> : <MoneyInput value={discount} onChange={setDiscount} />}
                </div>
              </div>}
              <div className="si-adj-g">
                <label>إضافة على الفاتورة</label>
                <div className="si-adj-row"><select className="select" style={{ maxWidth: 150 }} value={addName} onChange={(e) => setAddName(e.target.value)}><option value="">بدون</option><option value="رسوم توصيل">رسوم توصيل</option><option value="تغليف">تغليف</option></select><MoneyInput value={addAmt} onChange={setAddAmt} disabled={!addName} /></div>
              </div>
              {canDisc && <div className="si-adj-g"><label>خصم الفكة</label><div className="si-switch"><Switch checked={roundOn} onChange={setRoundOn} /><span onClick={() => setRoundOn(!roundOn)}>تقريب لأقرب جنيه{roundOff ? <span className="num muted"> (−{formatMoney(roundOff)})</span> : null}</span></div></div>}
                </div>
              </div>
            </details>
            <div className="si-bar">
              <button className="btn primary" disabled={busy || !lines.length} onClick={() => void save('new')}><Check /> حفظ <kbd>F12</kbd></button>
              <button className="btn primary" disabled={busy || !lines.length || !can(P ? 'purchases.print' : 'sales.print')} onClick={() => void save('print')}><Printer /> حفظ وطباعة <kbd>F4</kbd></button>
              <button className="btn" onClick={onNewTab}><Plus /> فاتورة جديدة <kbd>F10</kbd></button>
              <details className="si-more-actions"><summary>المزيد</summary>
                <button className="btn" disabled={busy || !lines.length} onClick={() => void save('view')}>حفظ وعرض <kbd>F9</kbd></button>
                <button className="btn" disabled={!lines.length} onClick={exportLines}><FileSpreadsheet /> Excel</button>
                <button className="btn" disabled={!lines.length} onClick={() => void shareInvoice()}><Share2 /> مشاركة</button>
                <label className="btn"><input type="checkbox" checked={printAfter} disabled={!can(P ? 'purchases.print' : 'sales.print')} onChange={(e) => setPrintAfter(e.target.checked)} /> طباعة تلقائية بعد الحفظ</label>
                <button className="btn" onClick={() => nav(`/docs/new/${P ? 'purchase_invoice' : 'sale_invoice'}?advanced=1`)}><Settings2 /> فاتورة متقدمة</button>
                {lines.length > 0 && <button className="btn danger" onClick={() => void newInvoice()}><X /> مسح الفاتورة</button>}
              </details>
            </div>
          </div>
        </div>
      </div>

      {inquiry && <InquirySheet purchase={P} itemId={inquiry} partyId={partyId} showCost={showCost} cost={costs.get(inquiry)} onClose={() => setInquiry(null)} />}
      {active && hover.node}
      {newItem && <QuickItemSheet onClose={() => setNewItem(false)} onSaved={(id) => setTimeout(() => void pick(id), 80)} />}
      {newParty && <QuickPartySheet kind={P ? 'supplier' : 'customer'} onClose={() => setNewParty(false)} onSaved={(id) => setPartyId(id)} />}
    </div>
  );
}

/** استعلام سريع عن صنف: الرصيد في كل مخزن، أسعار البيع، آخر سعر لهذا العميل، وسعر الشراء لمن يملك الصلاحية */
function InquirySheet({ purchase, itemId, partyId, showCost, cost, onClose }: { purchase?: boolean; itemId: string; partyId: string; showCost: boolean; cost: any; onClose: () => void }) {
  const data = useLiveQuery(async () => {
    const item = await db.items.get(itemId);
    const whs = new Map((await db.warehouses.toArray()).map((w) => [w.id, w.name]));
    const stock = (await db.stock_balances.where('item_id').equals(itemId).toArray()).map((b) => ({ name: whs.get(b.warehouse_id) ?? '', qty: b.qty }));
    const lists = new Map((await db.price_lists.toArray()).map((p) => [p.id, p.name]));
    const prices = (await db.item_prices.where('item_id').equals(itemId).toArray()).filter((p) => p.unit_name === item?.base_unit).map((p) => ({ name: lists.get(p.price_list_id) ?? p.price_list_id, price: p.price }));
    let lastSale: { price: number; date: string } | null = null;
    if (partyId && partyId !== 'party-cash-customer') {
      const docs = (await db.documents.where('party_id').equals(partyId).toArray()).filter((d) => d.doc_type === (purchase ? 'purchase_invoice' : 'sale_invoice') && d.status === 'posted');
      docs.sort((a, b) => String(b.date + (b.created_at ?? '')).localeCompare(String(a.date + (a.created_at ?? ''))));
      for (const d of docs) {
        const l = (await db.document_lines.where('document_id').equals(d.id).toArray()).find((x) => x.item_id === itemId);
        if (l) {
          lastSale = { price: l.unit_factor ? Math.round((l.price * 1000) / l.unit_factor) : l.price, date: d.date };
          break;
        }
      }
    }
    return { item, stock, prices, lastSale };
  }, [itemId, partyId, purchase]);
  const it = data?.item;
  return (
    <Sheet title={`استعلام: ${it?.name ?? ''}`} onClose={onClose}>
      {!data ? (
        <div className="muted">جارٍ التحميل…</div>
      ) : (
        <div className="stack">
          <div className="si-inq">
            <div className="si-inq-h">الرصيد في المخازن</div>
            {data.stock.length === 0 && <div className="muted small">لا يوجد رصيد مسجل</div>}
            {data.stock.map((s) => <div key={s.name} className="si-inq-row"><span>{s.name}</span><b className="num">{formatQty(s.qty)} {it?.base_unit}</b></div>)}
          </div>
          <div className="si-inq">
            <div className="si-inq-h">أسعار البيع (لكل {it?.base_unit})</div>
            <div className="si-inq-row"><span>السعر الأساسي</span><b className="num">{formatMoney(it?.sale_price ?? 0)}</b></div>
            {(it?.wholesale_price ?? 0) > 0 && <div className="si-inq-row"><span>الجملة</span><b className="num">{formatMoney(it!.wholesale_price)}</b></div>}
            {data.prices.map((p) => <div key={p.name} className="si-inq-row"><span>{p.name}</span><b className="num">{formatMoney(p.price)}</b></div>)}
            {data.lastSale && <div className="si-inq-row"><span>{purchase ? 'آخر سعر من هذا المورد' : 'آخر سعر لهذا العميل'}</span><b className="num">{formatMoney(data.lastSale.price)} <span className="muted small">({data.lastSale.date})</span></b></div>}
          </div>
          {showCost && (
            <div className="si-inq">
              <div className="si-inq-h">سعر الشراء</div>
              <CostCard c={cost} unit={it?.base_unit} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
