import { computeDocument, formatMoney, formatQty, hasPermission, parseMoney, todayISO, uuid, type DocInput } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Check, ChevronDown, ChevronUp, CreditCard, History, LayoutGrid, List, PackageCheck, Plus, Printer, ScanLine, ShoppingCart, Star, Trash2, UserRound, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, DocStatusBadge, MoneyInput, Picker, Sheet, useUi } from '../components/ui';
import { CategoryFilter } from '../components/Categories';
import { searchItems } from '../lib/search';
import { CustomerFields } from '../components/CustomerFields';
import { QuickPartySheet } from '../components/QuickParty';
import { priceFor, saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession, useSettings, userCashboxes } from '../lib/hooks';
import { useCostMap } from '../lib/costs';
import { CostCard, useHoverCard } from '../components/HoverCard';

interface CartLine {
  item_id: string;
  qty: number; // milli
  price: number;
  discount: number;
  tax_rate_bp: number;
}


/** البيع السريع: اختر الأصناف بلمسة ثم ادفع — مصمم للكاشير والشاشات اللمسية */
interface PosSummary {
  count: number;
  total: number;
  party: string | null;
}
const posDraftKey = (id: string) => `erp.pos.draft.${id}`;
function posStore(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* التخزين غير متاح */
  }
}

/** البيع السريع بتابات: كل تاب عملية بيع مستقلة (سلة وعميل)، محفوظة على الجهاز حتى تُدفع */
export function PosPage() {
  const ui = useUi();
  const [tabs, setTabs] = useState<string[]>(() => {
    try {
      const t = JSON.parse(localStorage.getItem('erp.pos.tabs') ?? '[]');
      if (Array.isArray(t) && t.length) return t;
    } catch {
      /* ignore */
    }
    return [uuid()];
  });
  const [active, setActive] = useState(tabs[0]);
  const [sums, setSums] = useState<Record<string, PosSummary>>({});
  useEffect(() => posStore('erp.pos.tabs', tabs), [tabs]);
  const cur = tabs.includes(active) ? active : tabs[0];
  useEffect(() => {
    document.title = 'بيع سريع — الحسابات';
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'بيع سريع';
  }, []);

  const newTab = () => {
    if (tabs.length >= 10) return ui.toast('الحد الأقصى 10 عمليات بيع مفتوحة', 'err');
    const id = uuid();
    setTabs((t) => [...t, id]);
    setActive(id);
  };
  const closeTab = async (id: string, ask = true) => {
    if (ask && (sums[id]?.count ?? 0) > 0) {
      const ok = await ui.confirm({ title: 'إغلاق عملية البيع؟', message: 'السلة فيها أصناف لم تُدفع وستُحذف.', confirmLabel: 'إغلاق', destructive: true });
      if (!ok) return;
    }
    posStore(posDraftKey(id), null);
    setTabs((t) => {
      const i = t.indexOf(id);
      const n = t.filter((x) => x !== id);
      if (!n.length) n.push(uuid());
      if (id === cur) setActive(n[Math.max(0, i - 1)] ?? n[0]);
      return n;
    });
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
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
    <div className="pos-wrap">
      <div className="pos-tabs" role="tablist" aria-label="عمليات البيع المفتوحة">
        {tabs.map((id, i) => {
          const sm = sums[id];
          return (
            <div key={id} role="tab" aria-selected={id === cur} tabIndex={0} className={`ss-tab ${id === cur ? 'on' : ''}`} onClick={() => setActive(id)} onKeyDown={(e) => e.key === 'Enter' && setActive(id)}>
              <span className="ss-tab-n">{i + 1}</span>
              <span className="ss-tab-t">{sm?.party ?? (sm?.count ? 'عميل نقدي' : 'بيع جديد')}</span>
              {sm && sm.count > 0 && <span className="ss-tab-v num">{formatMoney(sm.total)}</span>}
              <button className="ss-tab-x" title="إغلاق" aria-label={`إغلاق عملية البيع ${i + 1}`} onClick={(e) => { e.stopPropagation(); void closeTab(id); }}><X /></button>
            </div>
          );
        })}
        <button className="ss-tab-add" title="عملية بيع جديدة (F3)" onClick={newTab}><Plus /> بيع آخر</button>
      </div>
      {tabs.map((id) => (
        <PosSale
          key={id}
          tabId={id}
          active={id === cur}
          onSummary={(sm) => setSums((m) => (m[id] && m[id].count === sm.count && m[id].total === sm.total && m[id].party === sm.party ? m : { ...m, [id]: sm }))}
          onFinished={() => {
            if (tabs.length > 1) {
              void closeTab(id, false);
              return true;
            }
            return false;
          }}
        />
      ))}
    </div>
  );
}

function PosSale({ tabId, active, onSummary, onFinished }: { tabId: string; active: boolean; onSummary: (s: PosSummary) => void; onFinished: () => boolean }) {
  const ui = useUi();
  const nav = useNavigate();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [favs, setFavs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pos-favorites') ?? '[]');
    } catch {
      return [];
    }
  });
  const toggleFav = (id: string) =>
    setFavs((f) => {
      const n = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem('pos-favorites', JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  const [draft] = useState<{ cart?: CartLine[]; partyId?: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem(posDraftKey(tabId)) ?? '{}') ?? {};
    } catch {
      return {};
    }
  });
  const [cart, setCart] = useState<CartLine[]>(draft.cart ?? []);
  const [partyId, setPartyId] = useState(draft.partyId ?? 'party-cash-customer');
  const [pickParty, setPickParty] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [pay, setPay] = useState(false);
  // على الموبايل: السلة شريط صغير أسفل الشاشة يُفتح بلمسة فوق الأصناف
  const [cartOpen, setCartOpen] = useState(false);
  const [done, setDone] = useState<{ id: string; total: number; change: number } | null>(null);
  const [editLine, setEditLine] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const [sugHl, setSugHl] = useState(0);
  const viewKey = `erp.pos.view.${session.user.id}`;
  const [view, setView] = useState<{ mode: 'grid' | 'list'; inStock: boolean }>(() => {
    try {
      return { mode: 'grid', inStock: false, ...(JSON.parse(localStorage.getItem(viewKey) ?? '{}') ?? {}) };
    } catch {
      return { mode: 'grid', inStock: false };
    }
  });
  const setViewPref = (v: Partial<typeof view>) => {
    const n = { ...view, ...v };
    setView(n);
    try {
      localStorage.setItem(viewKey, JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };

  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false && (!session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id))), []) ?? [];
  const [whId, setWhId] = useState<string>('');
  const wh = whId || warehouses[0]?.id;
  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const items = useLiveQuery(async () => (await db.items.toArray()).filter((i) => i.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ar')), []) ?? [];
  const stock = useLiveQuery(async () => (wh ? new Map((await db.stock_balances.where('warehouse_id').equals(wh).toArray()).map((b) => [b.item_id, b.qty])) : new Map()), [wh]) ?? new Map();
  // سعر الشراء عند الإشارة للصنف (لمن لديه صلاحية رؤية التكلفة فقط)
  const showCost = can('costs.view');
  const costs = useCostMap(wh, showCost && active);
  const hover = useHoverCard();
  const costHover = (id: string, unit?: string) => (showCost ? hover.bind(<CostCard c={costs.get(id)} unit={unit} />) : {});
  const parties = useLiveQuery(async () => (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.active !== false), []) ?? [];
  const party = parties.find((p) => p.id === partyId);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const shown = useMemo(() => {
    const fav = new Set(favs);
    const avail = (i: any) => i.is_service || (stock.get(i.id) ?? 0) > 0;
    const pool = items.filter((i) => (cat === '__fav' ? fav.has(i.id) : !cat || i.category_id === cat) && (!view.inStock || avail(i)));
    // بحث ذكي بالكلام: أي جزء من الاسم أو الكود، أكثر من كلمة، مع توحيد الحروف العربية
    // أثناء البحث: الأقرب للكلام أولًا، مع تقديم المتوفر على غير المتوفر
    if (q.trim()) return searchItems(pool, q).sort((a, b) => Number(avail(b)) - Number(avail(a)));
    return [...pool].sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || Number(avail(b)) - Number(avail(a)) || a.name.localeCompare(b.name, 'ar'));
  }, [items, q, cat, favs, view.inStock, stock]);
  const LIMIT = 240;
  // التمرير إلى الصنف المحدد بالأسهم أثناء البحث
  useEffect(() => {
    document.querySelector('.pos-item.hl')?.scrollIntoView({ block: 'nearest' });
  }, [sugHl]);

  // لا نبيع أكثر من الرصيد المتاح (إلا إذا سمحت الإعدادات بالبيع بالسالب)؛
  // وإلا يُحفظ البيع «بانتظار المراجعة» ولا تُسجل المديونية حتى يُعالج
  const settings = useSettings();
  const fits = (itemId: string, total: number) => {
    const it = itemMap.get(itemId);
    if (!it || it.is_service || settings.allow_negative_stock) return true;
    const have = stock.get(itemId) ?? 0;
    if (total <= have) return true;
    ui.toast(have > 0 ? `الرصيد غير كافٍ: المتاح من «${it.name}» ${formatQty(have)} فقط` : `«${it.name}» غير متوفر في المخزن (الرصيد صفر)`, 'err');
    return false;
  };
  const add = async (itemId: string, qty = 1000) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    if (!fits(itemId, (cart.find((l) => l.item_id === itemId)?.qty ?? 0) + qty)) return;
    const price = await priceFor(it, { name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price }, party?.price_list_id ?? 'pl-retail');
    setCart((c) => {
      const ex = c.find((l) => l.item_id === itemId);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + qty } : l));
      return [...c, { item_id: itemId, qty, price, discount: 0, tax_rate_bp: it.tax_rate_bp ?? 0 }];
    });
  };
  const setQty = (itemId: string, qty: number) => (qty > (cart.find((l) => l.item_id === itemId)?.qty ?? 0) && !fits(itemId, qty)) || setCart((c) => (qty <= 0 ? c.filter((l) => l.item_id !== itemId) : c.map((l) => (l.item_id === itemId ? { ...l, qty } : l))));

  const onSearchEnter = async () => {
    const code = q.trim();
    if (!code) return;
    const unit = await db.item_units.where('barcode').equals(code).first();
    if (unit) {
      await add(unit.item_id, unit.factor);
      setQ('');
      return;
    }
    const it = (await db.items.where('barcode').equals(code).first()) ?? (await db.items.where('code').equals(code).first());
    if (it) {
      await add(it.id);
      setQ('');
    } else if (shown[sugHl]) {
      await add(shown[sugHl].id);
      setQ('');
    } else ui.toast(`لا يوجد صنف باسم أو كود «${code}»`, 'err');
  };

  const calc = useMemo(() => computeDocument(cart.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp })), 0), [cart]);
  const count = cart.reduce((s, l) => s + l.qty, 0) / 1000;

  const partyName = partyId === 'party-cash-customer' ? null : party?.name ?? null;
  useEffect(() => {
    posStore(posDraftKey(tabId), cart.length || partyId !== 'party-cash-customer' ? { cart, partyId } : null);
    onSummary({ count: cart.length, total: calc.total ?? 0, party: partyName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, partyId, calc.total, partyName]);
  useEffect(() => {
    if (active) setTimeout(() => searchRef.current?.focus(), 30);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) && cart.length && !pay && !done) {
        e.preventDefault();
        setPay(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cart.length, pay, done, active]);

  const newSale = () => {
    if (onFinished()) return;
    setCart([]);
    setPartyId('party-cash-customer');
    setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  if (!wh) return active ? <div className="page"><Banner kind="warn">لا يوجد مخزن مسموح لك بالبيع منه.</Banner></div> : null;

  return (
    <div className="pos" style={active ? undefined : { display: 'none' }}>
      <div className="pos-left">
        <div className="row" style={{ gap: 10 }}>
          <div className="search" ref={searchBox} style={{ flex: 1, height: 46, background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <ScanLine />
            <input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); setSugHl(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && q.trim()) { e.preventDefault(); setSugHl((h) => Math.min(h + 1, Math.min(shown.length, LIMIT) - 1)); }
                else if (e.key === 'ArrowUp' && q.trim()) { e.preventDefault(); setSugHl((h) => Math.max(h - 1, 0)); }
                else if (e.key === 'Escape') setQ('');
                else if (e.key === 'Enter') { e.preventDefault(); void onSearchEnter(); }
              }}
              placeholder="ابحث باسم الصنف أو جزء منه أو الكود، أو امسح الباركود (F2)"
              style={{ fontSize: 16 }}
            />
            {q && <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setQ('')}><X style={{ width: 16, height: 16 }} /></button>}
          </div>
          <CategoryFilter value={cat === '__fav' ? '' : cat} onChange={(id) => { setCat(id); searchRef.current?.focus(); }} className="pos-cat-select" />
          {warehouses.length > 1 && (
            <select className="select" style={{ width: 170, background: 'var(--card)' }} value={wh} onChange={(e) => setWhId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <div className="pos-tools">
          <div className="pos-cats">
            <button className={cat !== '__fav' ? 'on' : ''} onClick={() => setCat('')}>كل الأصناف</button>
            {favs.length > 0 && <button className={`fav ${cat === '__fav' ? 'on' : ''}`} onClick={() => setCat('__fav')}><Star /> المفضلة <span className="num">{favs.length}</span></button>}
            <button className={view.inStock ? 'on' : ''} onClick={() => setViewPref({ inStock: !view.inStock })} title="إخفاء الأصناف التي رصيدها صفر"><PackageCheck /> المتوفر فقط</button>
          </div>
          <span className="pos-count muted small">{shown.length > LIMIT ? `يعرض ${LIMIT} من ${shown.length} — ابحث أو اختر تصنيفًا` : `${shown.length} صنف`}</span>
          <div className="segmented pos-view" role="group" aria-label="طريقة العرض">
            <button className={view.mode === 'grid' ? 'on' : ''} title="مربعات" aria-label="عرض مربعات" onClick={() => setViewPref({ mode: 'grid' })}><LayoutGrid /></button>
            <button className={view.mode === 'list' ? 'on' : ''} title="قائمة" aria-label="عرض قائمة" onClick={() => setViewPref({ mode: 'list' })}><List /></button>
          </div>
        </div>
        <div className={`pos-grid ${view.mode === 'list' ? 'as-list' : ''}`}>
          {shown.length === 0 && <div className="muted" style={{ padding: 20 }}>لا توجد أصناف{q ? ' مطابقة' : ''}. أضف الأصناف من قسم المخزون.</div>}
          {shown.length > 0 && favs.length === 0 && !q && <div className="footnote" style={{ gridColumn: '1 / -1' }}>اضغط ☆ على أي صنف تستخدمه كثيرًا ليظهر أولًا وفي تبويب «المفضلة».</div>}
          {shown.slice(0, LIMIT).map((i, idx) => {
            const inCart = cart.find((l) => l.item_id === i.id);
            const have = stock.get(i.id) ?? 0;
            const out = !i.is_service && have <= 0;
            const isFav = favs.includes(i.id);
            return (
              <button key={i.id} className={`pos-item ${out ? 'out' : ''} ${inCart ? 'in-cart' : ''} ${q.trim() && idx === sugHl ? 'hl' : ''}`} onClick={() => { hover.hide(); void add(i.id); }} {...costHover(i.id, i.base_unit)}>
                <span className="pi-top">
                  <span className="pi-name" title={i.name}>{i.name}</span>
                  <span
                    role="button"
                    className={`pi-star ${isFav ? 'on' : ''}`}
                    title={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(i.id);
                    }}
                  >
                    <Star />
                  </span>
                </span>
                <span className="pi-code num">{i.code}</span>
                <span className="pi-bottom">
                  <span className="pi-price num">{formatMoney(i.sale_price)}</span>
                  <span className={`pi-qty ${out ? 'out' : ''}`}>{i.is_service ? 'خدمة' : out ? 'نفد' : `متاح ${formatQty(have)}`}</span>
                </span>
                {inCart && <span className="pi-badge num">{formatQty(inCart.qty)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {cartOpen && <div className="pos-cart-scrim only-mobile" onClick={() => setCartOpen(false)} />}
      <div className={`pos-cart ${cartOpen ? 'open' : ''}`}>
        <div className="pos-cart-head">
          <button type="button" className="icon-btn only-mobile" aria-label="إغلاق السلة" onClick={() => setCartOpen(false)}><ChevronDown /></button>
          <ShoppingCart style={{ color: 'var(--tint)' }} />
          <div className="bold" style={{ flex: 1, fontSize: 17 }}>السلة {count > 0 && <span className="muted small">({formatQty(count * 1000)} قطعة)</span>}</div>
          {can('sales.view') && <button className="btn sm plain" onClick={() => setRecentOpen(true)} title="آخر المبيعات"><History /> <span className="hide-mobile">آخر المبيعات</span></button>}
          {cart.length > 0 && <button className="btn sm plain danger" onClick={() => setCart([])}><Trash2 /> تفريغ</button>}
        </div>
        <div className="pos-cust" style={{ padding: '0 18px 8px' }}>
          <button className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => setPickParty(true)}>
            <UserRound /> {party?.name ?? 'عميل نقدي'}
          </button>
        </div>
        <div className="pos-cart-lines">
          {cart.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: '40px 10px' }}>
              <ShoppingCart style={{ width: 44, height: 44, color: 'var(--label-3)' }} />
              <div style={{ marginTop: 8 }}>اضغط على أي صنف لإضافته</div>
            </div>
          )}
          {cart.map((l, idx) => {
            const it = itemMap.get(l.item_id);
            const have = stock.get(l.item_id) ?? 0;
            const short = it && !it.is_service && l.qty > have;
            return (
              <div key={l.item_id} className="pos-line">
                <div className="pl-name">
                  <div onClick={() => { hover.hide(); setEditLine(l.item_id); }} style={{ cursor: 'pointer' }} title="اضغط لتعديل الكمية والسعر والخصم" {...costHover(l.item_id, it?.base_unit)}>{it?.name}</div>
                  <div className="pl-sub num">
                    {can('sales.price_change') ? (
                      <span className="pl-price" title="سعر الوحدة — اكتب السعر الجديد">
                        <MoneyInput value={l.price} onChange={(v) => setCart((c) => c.map((x) => (x.item_id === l.item_id ? { ...x, price: Math.max(0, v) } : x)))} />
                      </span>
                    ) : formatMoney(l.price)}
                    {l.discount ? ` · خصم ${formatMoney(l.discount)}` : ''} {short ? <span className="red">· الرصيد {formatQty(have)}</span> : null}
                  </div>
                </div>
                <div className="stepper">
                  <button onClick={() => setQty(l.item_id, l.qty + 1000)}>+</button>
                  <span>{formatQty(l.qty)}</span>
                  <button onClick={() => setQty(l.item_id, l.qty - 1000)}>−</button>
                </div>
                <div className="num bold" style={{ minWidth: 70, textAlign: 'left' }}>{formatMoney(calc.lines[idx]?.total ?? 0)}</div>
              </div>
            );
          })}
        </div>
        <div className="pos-cart-foot">
          <button type="button" className="pos-cart-toggle only-mobile" onClick={() => setCartOpen(!cartOpen)} aria-expanded={cartOpen}>
            <ShoppingCart />
            <span>السلة {count > 0 ? <b className="num">({formatQty(count * 1000)})</b> : null}</span>
            <span className="num pct-total">{formatMoney(calc.total)}</span>
            {cartOpen ? <ChevronDown /> : <ChevronUp />}
          </button>
          {calc.tax > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">منها ضريبة</span><span className="num">{formatMoney(calc.tax)}</span></div>}
          {calc.discount > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">خصومات</span><span className="num">{formatMoney(calc.discount)}</span></div>}
          <div className="pos-total"><span>الإجمالي</span><span className="num">{formatMoney(calc.total)}</span></div>
          <button className="btn primary xl block" disabled={!cart.length} onClick={() => { setCartOpen(false); setPay(true); }}>ادفع <span className="caption" style={{ color: 'rgba(255,255,255,.8)' }}>F9</span></button>
        </div>
      </div>

      {pickParty && (
        <Sheet title="اختر العميل" onClose={() => setPickParty(false)}>
          <div className="stack">
            <Picker
              autoFocus
              value={partyId}
              options={parties.map((p) => ({ id: p.id, label: p.name, sub: p.phone ?? p.code, search: `${p.name} ${p.code} ${p.phone ?? ''}` }))}
              onChange={(v) => {
                setPartyId(v ?? 'party-cash-customer');
                setPickParty(false);
              }}
              placeholder="ابحث بالاسم أو الهاتف"
              createLabel="عميل"
              onCreate={can('parties.create') ? (t) => { setNewCustomerName(t); setPickParty(false); setNewCustomer(true); } : undefined}
            />
            <button className="btn" onClick={() => { setPartyId('party-cash-customer'); setPickParty(false); }}>عميل نقدي</button>
            <button className="btn" onClick={() => { setPickParty(false); setNewCustomer(true); }}><UserRound /> إضافة عميل جديد</button>
          </div>
        </Sheet>
      )}
      {editLine && (
        <LineSheet
          line={cart.find((l) => l.item_id === editLine)!}
          name={itemMap.get(editLine)?.name ?? ''}
          canPrice={can('sales.price_change')}
          canDiscount={can('sales.discount')}
          onClose={() => setEditLine(null)}
          onSave={(p) => {
            if (p.qty != null && p.qty > (cart.find((l) => l.item_id === editLine)?.qty ?? 0) && !fits(editLine, p.qty)) return;
            setCart((c) => c.map((l) => (l.item_id === editLine ? { ...l, ...p } : l)).filter((l) => l.qty > 0));
            setEditLine(null);
          }}
        />
      )}
      {pay && (
        <PaySheet
          total={calc.total}
          party={party}
          canCredit={can('sales.credit')}
          onPickParty={(id) => setPartyId(id)}
          onNewCustomer={() => setNewCustomer(true)}
          onClose={() => setPay(false)}
          onPaid={async ({ payments, credit, change }) => {
            const cashboxId = payments[0]?.cashbox_id ?? null;
            const myShift = (await db.cashier_shifts.where('user_id').equals(session.user.id).toArray()).find((s) => s.status === 'open' && !s._sync);
            const id = uuid();
            const doc: DocInput = {
              id,
              doc_type: 'sale_invoice',
              date: todayISO(),
              party_id: partyId,
              warehouse_id: wh,
              cashbox_id: cashboxId,
              price_list_id: party?.price_list_id ?? 'pl-retail',
              payment_type: credit > 0 ? 'credit' : 'cash',
              payments: payments.map((x) => ({ id: uuid(), cashbox_id: x.cashbox_id, amount: x.amount })),
              instruments: [],
              charges: [],
              shift_id: myShift && payments.some((x) => x.cashbox_id === myShift.cashbox_id) ? myShift.id : null,
              lines: cart.map((l) => ({ id: uuid(), item_id: l.item_id, unit_name: itemMap.get(l.item_id)!.base_unit, unit_factor: 1000, qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp, serials: [], expiry: null, ref_line_id: null, notes: null })),
              journal_lines: [],
              paid: 0,
              amount: 0,
              discount: 0,
              reserve: false,
              deliver_later: false,
              retained_bp: 0,
            } as DocInput;
            await saveDocument(doc, 'post', null);
            setPay(false);
            setDone({ id, total: calc.total, change });
          }}
        />
      )}
      {active && hover.node}
      {recentOpen && <RecentSales onClose={() => setRecentOpen(false)} />}
      {newCustomer && <QuickPartySheet initialName={newCustomerName} onClose={() => { setNewCustomer(false); setNewCustomerName(''); }} onSaved={(id) => setPartyId(id)} />}
      {done && (
        <Sheet title="تم البيع" onClose={newSale}>
          <div className="stack" style={{ textAlign: 'center' }}>
            <div className="done-check"><Check /></div>
            <div className="big-amount num">{formatMoney(done.total)}</div>
            {done.change > 0 && <div style={{ fontSize: 22 }}>الباقي للعميل: <b className="num green">{formatMoney(done.change)}</b></div>}
            <div className="footnote">حُفظت الفاتورة على الجهاز وتُرحّل عند المزامنة.</div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn lg" style={{ flex: 1 }} onClick={() => window.open(`/print/${done.id}?t=thermal80&auto=1`, '_blank')}><Printer /> طباعة الإيصال</button>
              <button className="btn primary lg" style={{ flex: 1 }} onClick={newSale} autoFocus>بيع جديد</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function LineSheet({ line, name, canPrice, canDiscount, onClose, onSave }: { line: CartLine; name: string; canPrice: boolean; canDiscount: boolean; onClose: () => void; onSave: (p: Partial<CartLine>) => void }) {
  const [qty, setQty] = useState(formatQty(line.qty));
  const [price, setPrice] = useState(String(line.price / 100));
  const [disc, setDisc] = useState(String(line.discount / 100));
  const save = () => {
    try {
      onSave({ qty: Math.round(Number(qty.replace(',', '')) * 1000), price: parseMoney(price), discount: parseMoney(disc || '0') });
    } catch {
      /* ignore */
    }
  };
  return (
    <Sheet title={name} onClose={onClose} footer={<><button className="btn danger" onClick={() => onSave({ qty: 0 })}><Trash2 /> حذف</button><span className="spacer" /><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={save}>تم</button></>}>
      <div className="grid grid-3">
        <label className="field"><label>الكمية</label><input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
        <label className="field"><label>السعر</label><input className="input num" inputMode="decimal" value={price} disabled={!canPrice} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field"><label>خصم</label><input className="input num" inputMode="decimal" value={disc} disabled={!canDiscount} onChange={(e) => setDisc(e.target.value)} /></label>
      </div>
    </Sheet>
  );
}

export interface PayResult {
  payments: { cashbox_id: string; amount: number }[];
  credit: number;
  change: number;
}

/**
 * الدفع في البيع السريع: طريقة أساسية + المبلغ المستلم بها، ولو أقل من الإجمالي يظهر «الباقي»
 * ويُختار له طريقة ثانية (خزينة/بنك) أو آجل. نوع العميل يتبع طرق الدفع تلقائيًا (نقدي/بنك/آجل).
 */
function PaySheet({ total, party, canCredit, onClose, onPaid, onPickParty }: { total: number; party: any; canCredit: boolean; onClose: () => void; onPaid: (r: PayResult) => Promise<void>; onPickParty: (id: string) => void; onNewCustomer?: () => void }) {
  const { session } = useSession();
  const boxes = useLiveQuery(
    async () =>
      userCashboxes(session.user),
    [],
  ) ?? [];
  const [primary, setPrimary] = useState<string>(''); // id خزينة أو 'credit'
  const [received, setReceived] = useState('');
  const [rest, setRest] = useState<string>(''); // طريقة الباقي: id خزينة أو 'credit'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const prim = primary || boxes[0]?.id || (canCredit ? 'credit' : '');
  const primBox = boxes.find((b) => b.id === prim);
  const isCredit = prim === 'credit';
  let recv = total;
  if (!isCredit && received.trim()) {
    try {
      recv = parseMoney(received);
    } catch {
      recv = 0;
    }
  }
  const paidPrimary = isCredit ? 0 : Math.min(recv, total);
  const change = !isCredit && primBox?.kind === 'cash' ? Math.max(recv - total, 0) : 0;
  const remainder = total - paidPrimary;
  const restBox = boxes.find((b) => b.id === rest);
  const credit = isCredit ? total : remainder > 0 && rest === 'credit' ? remainder : 0;
  const isCashCustomer = !party || party.id === 'party-cash-customer';
  // نوع العميل يتبع طرق الدفع
  const anyBank = (!isCredit && primBox?.kind === 'bank' && paidPrimary > 0) || (remainder > 0 && restBox?.kind === 'bank');
  const autoGroup = credit > 0 ? 'آجل' : anyBank ? 'بنك' : 'نقدي';

  const choosePrimary = (id: string) => {
    setPrimary(id);
    setReceived('');
    setRest('');
    setErr(null);
    if (id !== 'credit') setTimeout(() => amountRef.current?.focus(), 30);
  };

  const confirm = async () => {
    setErr(null);
    if (!prim) return setErr('لا توجد خزائن. أضفها من «الخزائن والبنوك»');
    if (!isCredit && recv <= 0) return setErr('اكتب المبلغ المستلم');
    if (remainder > 0 && !isCredit && !rest) return setErr(`حدد طريقة دفع الباقي (${formatMoney(remainder)})`);
    if (credit > 0 && isCashCustomer) return setErr('الجزء الآجل يحتاج عميلًا مسجلًا: اختره أو أضف عميلًا جديدًا');
    const payments: { cashbox_id: string; amount: number }[] = [];
    if (!isCredit && paidPrimary > 0) payments.push({ cashbox_id: prim, amount: paidPrimary });
    if (!isCredit && remainder > 0 && restBox) payments.push({ cashbox_id: restBox.id, amount: remainder });
    setBusy(true);
    try {
      await onPaid({ payments, credit, change });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="الدفع" onClose={onClose}>
      <div className="stack" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).closest('.pay-amount') && (e.preventDefault(), void confirm())}>
        <div className="big-amount num">{formatMoney(total)}</div>
        {err && <Banner kind="err">{err}</Banner>}

        <div className="pay-methods" style={{ gridTemplateColumns: `repeat(${Math.min(boxes.length + (canCredit ? 1 : 0), 4)}, 1fr)` }}>
          {boxes.map((b) => (
            <button key={b.id} className={prim === b.id ? 'on' : ''} onClick={() => choosePrimary(b.id)}>
              {b.kind === 'bank' ? <CreditCard /> : <Banknote />}
              {b.name}
            </button>
          ))}
          {canCredit && <button className={isCredit ? 'on' : ''} onClick={() => choosePrimary('credit')}><Wallet />آجل</button>}
        </div>

        {!isCredit && (
          <div className="pay-amount">
            <label htmlFor="pay-recv">المبلغ المدفوع {primBox ? (primBox.kind === 'cash' ? 'نقدًا' : `بـ ${primBox.name}`) : ''}</label>
            <input id="pay-recv" ref={amountRef} className="input num" inputMode="decimal" placeholder={formatMoney(total)} value={received} onChange={(e) => { setReceived(e.target.value); setErr(null); }} autoFocus />
          </div>
        )}

        {change > 0 && (
          <div className="pay-line ok"><span>الباقي للعميل</span><b className="num">{formatMoney(change)}</b></div>
        )}

        {!isCredit && remainder > 0 && (
          <div className="pay-rest">
            <div className="pay-line warn"><span>الباقي المطلوب</span><b className="num">{formatMoney(remainder)}</b></div>
            <div className="pay-rest-l">يُدفع الباقي بـ:</div>
            <div className="pay-methods sm" style={{ gridTemplateColumns: `repeat(${Math.min(boxes.length - 1 + (canCredit ? 1 : 0), 4) || 1}, 1fr)` }}>
              {boxes.filter((b) => b.id !== prim).map((b) => (
                <button key={b.id} className={rest === b.id ? 'on' : ''} onClick={() => setRest(b.id)}>
                  {b.kind === 'bank' ? <CreditCard /> : <Banknote />}
                  {b.name}
                </button>
              ))}
              {canCredit && <button className={rest === 'credit' ? 'on' : ''} onClick={() => setRest('credit')}><Wallet />آجل</button>}
            </div>
          </div>
        )}

        <div className="stack" style={{ gap: 6 }}>
          {credit > 0 && isCashCustomer && <Banner kind="warn">الجزء الآجل يُسجل على عميل: اختره أو أضف عميلًا جديدًا</Banner>}
          <CustomerFields partyId={party?.id ?? 'party-cash-customer'} onChange={onPickParty} layout="row" autoGroupName={autoGroup} />
          {!isCashCustomer && <div className="footnote">{credit > 0 ? `سيُسجل ${formatMoney(credit)} دينًا على ${party.name} — رصيده الحالي ${formatMoney(party.balance ?? 0)}` : `الفاتورة تُحفظ في سجل ${party.name} بدون دين.`}</div>}
        </div>

        {(payments_preview(paidPrimary, primBox, remainder, restBox, credit, isCredit, total)).length > 1 && (
          <div className="pay-summary">
            {payments_preview(paidPrimary, primBox, remainder, restBox, credit, isCredit, total).map((p) => (
              <span key={p.k}>{p.label} <b className="num">{formatMoney(p.amount)}</b></span>
            ))}
          </div>
        )}
        <button className="btn success primary xl block" disabled={busy} onClick={confirm}><Check /> تأكيد البيع</button>
      </div>
    </Sheet>
  );
}

/** ملخص توزيع المبلغ على طرق الدفع (للعرض) */
function payments_preview(paidPrimary: number, primBox: any, remainder: number, restBox: any, credit: number, isCredit: boolean, total: number) {
  const out: { k: string; label: string; amount: number }[] = [];
  if (isCredit) return [{ k: 'c', label: 'آجل', amount: total }];
  if (paidPrimary > 0 && primBox) out.push({ k: 'p', label: primBox.kind === 'cash' ? 'نقدي' : primBox.name, amount: paidPrimary });
  if (remainder > 0 && restBox) out.push({ k: 'r', label: restBox.kind === 'cash' ? 'نقدي' : restBox.name, amount: remainder });
  if (credit > 0) out.push({ k: 'c', label: 'آجل', amount: credit });
  return out;
}

/** آخر المبيعات للكاشير: فتح الفاتورة أو إعادة طباعتها بدون مغادرة البيع السريع */
function RecentSales({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const [mine, setMine] = useState(true);
  const rows = useLiveQuery(async () => {
    const docs = await db.documents.where('doc_type').equals('sale_invoice').toArray();
    const parties = new Map((await db.parties.toArray()).map((p) => [p.id, p.name]));
    return docs
      .filter((d) => !mine || !d.created_by || d.created_by === session.user.id)
      .sort((a, b) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date)))
      .slice(0, 15)
      .map((d) => ({ ...d, party: parties.get(d.party_id) ?? '' }) as any);
  }, [mine, session.user.id]);
  return (
    <Sheet title="آخر المبيعات" onClose={onClose}>
      <div className="stack">
        <div className="segmented block">
          <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>مبيعاتي</button>
          <button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>كل المبيعات</button>
        </div>
        {rows && rows.length === 0 && <div className="muted" style={{ padding: 12 }}>لا توجد مبيعات بعد.</div>}
        <div className="list">
          {rows?.map((d) => (
            <div key={d.id} className="list-row">
              <div className="title">
                <span className="num">{d.number ?? d.local_number}</span> · {d.party}
                <div className="sub num">{d.date}</div>
              </div>
              <DocStatusBadge status={d.status} sync={d._sync} />
              <b className="num">{formatMoney(d.total)}</b>
              <button className="btn sm" onClick={() => { onClose(); nav(`/docs/view/${d.id}`); }}>عرض</button>
              {can('sales.print') && <button className="icon-btn" title="طباعة" aria-label="طباعة" onClick={() => window.open(`/print/${d.id}`, '_blank')}><Printer /></button>}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

