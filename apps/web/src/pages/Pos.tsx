import { computeDocument, formatMoney, formatQty, hasPermission, parseMoney, todayISO, uuid, type DocInput } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Check, CreditCard, History, Printer, ScanLine, ShoppingCart, Star, Trash2, UserRound, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, DocStatusBadge, Picker, Sheet, useUi } from '../components/ui';
import { CustomerFields } from '../components/CustomerFields';
import { QuickPartySheet } from '../components/QuickParty';
import { priceFor, saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession } from '../lib/hooks';

interface CartLine {
  item_id: string;
  qty: number; // milli
  price: number;
  discount: number;
  tax_rate_bp: number;
}

const AVATAR = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5856D6', '#30B0C7', '#A2845E'];
const colorFor = (s: string) => AVATAR[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

/** البيع السريع: اختر الأصناف بلمسة ثم ادفع — مصمم للكاشير والشاشات اللمسية */
export function PosPage() {
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [partyId, setPartyId] = useState('party-cash-customer');
  const [pickParty, setPickParty] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [pay, setPay] = useState(false);
  const [done, setDone] = useState<{ id: string; total: number; change: number } | null>(null);
  const [editLine, setEditLine] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false && (!session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id))), []) ?? [];
  const [whId, setWhId] = useState<string>('');
  const wh = whId || warehouses[0]?.id;
  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const items = useLiveQuery(async () => (await db.items.toArray()).filter((i) => i.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ar')), []) ?? [];
  const stock = useLiveQuery(async () => (wh ? new Map((await db.stock_balances.where('warehouse_id').equals(wh).toArray()).map((b) => [b.item_id, b.qty])) : new Map()), [wh]) ?? new Map();
  const parties = useLiveQuery(async () => (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.active !== false), []) ?? [];
  const party = parties.find((p) => p.id === partyId);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const fav = new Set(favs);
    return items
      .filter((i) => (cat === '__fav' ? fav.has(i.id) : !cat || i.category_id === cat) && (!s || [i.name, i.code, i.barcode].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)))
      .slice(0, 120);
  }, [items, q, cat, favs]);

  useEffect(() => {
    document.title = 'بيع سريع — الحسابات';
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'بيع سريع';
  }, []);

  const add = async (itemId: string, qty = 1000) => {
    const it = itemMap.get(itemId);
    if (!it) return;
    const price = await priceFor(it, { name: it.base_unit, factor: 1000, sale_price: it.sale_price, wholesale_price: it.wholesale_price }, party?.price_list_id ?? 'pl-retail');
    setCart((c) => {
      const ex = c.find((l) => l.item_id === itemId);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + qty } : l));
      return [...c, { item_id: itemId, qty, price, discount: 0, tax_rate_bp: it.tax_rate_bp ?? 0 }];
    });
  };
  const setQty = (itemId: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.item_id !== itemId) : c.map((l) => (l.item_id === itemId ? { ...l, qty } : l))));

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
    } else if (shown.length === 1) {
      await add(shown[0].id);
      setQ('');
    } else ui.toast(`لا يوجد صنف بالكود ${code}`, 'err');
  };

  const calc = useMemo(() => computeDocument(cart.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount, tax_rate_bp: l.tax_rate_bp })), 0), [cart]);
  const count = cart.reduce((s, l) => s + l.qty, 0) / 1000;

  useEffect(() => {
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
  }, [cart.length, pay, done]);

  const newSale = () => {
    setCart([]);
    setPartyId('party-cash-customer');
    setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  if (!wh) return <div className="page"><Banner kind="warn">لا يوجد مخزن مسموح لك بالبيع منه.</Banner></div>;

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="row" style={{ gap: 10 }}>
          <div className="search" style={{ flex: 1, height: 52, background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <ScanLine />
            <input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void onSearchEnter())}
              placeholder="امسح الباركود أو ابحث باسم الصنف (F2)"
              style={{ fontSize: 17 }}
            />
            {q && <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setQ('')}><X style={{ width: 16, height: 16 }} /></button>}
          </div>
          {warehouses.length > 1 && (
            <select className="select" style={{ width: 170, background: 'var(--card)' }} value={wh} onChange={(e) => setWhId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        {(cats.length > 1 || favs.length > 0) && (
          <div className="pos-cats">
            <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>الكل</button>
            {favs.length > 0 && <button className={`fav ${cat === '__fav' ? 'on' : ''}`} onClick={() => setCat('__fav')}><Star /> المفضلة</button>}
            {cats.length > 1 && cats.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
        )}
        <div className="pos-grid">
          {shown.length === 0 && <div className="muted" style={{ padding: 20 }}>لا توجد أصناف{q ? ' مطابقة' : ''}. أضف الأصناف من قسم المخزون.</div>}
          {shown.length > 0 && favs.length === 0 && !q && <div className="footnote" style={{ gridColumn: '1 / -1' }}>اضغط ☆ على أي صنف تستخدمه كثيرًا ليظهر أولًا وفي تبويب «المفضلة».</div>}
          {shown.map((i) => {
            const inCart = cart.find((l) => l.item_id === i.id);
            const have = stock.get(i.id) ?? 0;
            const out = !i.is_service && have <= 0;
            const isFav = favs.includes(i.id);
            return (
              <button key={i.id} className={`pos-item ${out ? 'out' : ''}`} onClick={() => void add(i.id)}>
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
                {inCart && <span className="pi-badge">{formatQty(inCart.qty)}</span>}
                <span className="pi-avatar" style={{ background: colorFor(i.name) }}>{i.name.trim()[0]}</span>
                <span className="pi-name">{i.name}</span>
                <span className="pi-price num">{formatMoney(i.sale_price)}</span>
                <span className="pi-qty">{i.is_service ? 'خدمة' : out ? 'غير متوفر' : `متاح ${formatQty(have)}`}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pos-cart">
        <div className="pos-cart-head">
          <ShoppingCart style={{ color: 'var(--tint)' }} />
          <div className="bold" style={{ flex: 1, fontSize: 17 }}>السلة {count > 0 && <span className="muted small">({formatQty(count * 1000)} قطعة)</span>}</div>
          {can('sales.view') && <button className="btn sm plain" onClick={() => setRecentOpen(true)} title="آخر المبيعات"><History /> <span className="hide-mobile">آخر المبيعات</span></button>}
          {cart.length > 0 && <button className="btn sm plain danger" onClick={() => setCart([])}><Trash2 /> تفريغ</button>}
        </div>
        <div style={{ padding: '0 18px 8px' }}>
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
                <div className="pl-name" onClick={() => setEditLine(l.item_id)} style={{ cursor: 'pointer' }}>
                  <div>{it?.name}</div>
                  <div className="pl-sub num">{formatMoney(l.price)} {l.discount ? `· خصم ${formatMoney(l.discount)}` : ''} {short ? <span className="red">· الرصيد {formatQty(have)}</span> : null}</div>
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
          {calc.tax > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">منها ضريبة</span><span className="num">{formatMoney(calc.tax)}</span></div>}
          {calc.discount > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">خصومات</span><span className="num">{formatMoney(calc.discount)}</span></div>}
          <div className="pos-total"><span>الإجمالي</span><span className="num">{formatMoney(calc.total)}</span></div>
          <button className="btn primary xl block" disabled={!cart.length} onClick={() => setPay(true)}>ادفع <span className="caption" style={{ color: 'rgba(255,255,255,.8)' }}>F9</span></button>
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
          onPaid={async (method, cashboxId, received) => {
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
              payment_type: method === 'credit' ? 'credit' : 'cash',
              payments: method === 'credit' ? [] : [{ id: uuid(), cashbox_id: cashboxId!, amount: calc.total }],
              instruments: [],
              charges: [],
              shift_id: myShift && myShift.cashbox_id === cashboxId ? myShift.id : null,
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
            setDone({ id, total: calc.total, change: method === 'cash' ? Math.max(received - calc.total, 0) : 0 });
          }}
        />
      )}
      {recentOpen && <RecentSales onClose={() => setRecentOpen(false)} />}
      {newCustomer && <QuickPartySheet onClose={() => setNewCustomer(false)} onSaved={(id) => setPartyId(id)} />}
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

function PaySheet({ total, party, canCredit, onClose, onPaid, onPickParty, onNewCustomer }: { total: number; party: any; canCredit: boolean; onClose: () => void; onPaid: (method: 'cash' | 'card' | 'credit', cashboxId: string | null, received: number) => Promise<void>; onPickParty: (id: string) => void; onNewCustomer: () => void }) {
  const { session } = useSession();
  const boxes = useLiveQuery(
    async () =>
      (await db.cashboxes.toArray())
        .filter((c) => c.active !== false && (!session.user.cashbox_ids || session.user.cashbox_ids.includes(c.id)))
        .sort((x, y) => (x.kind === y.kind ? String(x.name).localeCompare(String(y.name), 'ar') : x.kind === 'cash' ? -1 : 1)),
    [],
  ) ?? [];
  const customers = useLiveQuery(async () => (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.active !== false && p.id !== 'party-cash-customer'), []) ?? [];
  const cash = boxes.filter((b) => b.kind === 'cash');
  const cards = boxes.filter((b) => b.kind === 'bank');
  const [method, setMethod] = useState<'cash' | 'card' | 'credit'>('cash');
  const [boxId, setBoxId] = useState<string>('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = method === 'cash' ? cash : cards;
  const box = boxId && boxes.some((b) => b.id === boxId) ? boxId : list[0]?.id;
  let recv = 0;
  try {
    recv = received ? parseMoney(received) : total;
  } catch {
    recv = 0;
  }
  const change = recv - total;
  const isCashCustomer = !party || party.id === 'party-cash-customer';
  const key = (k: string) => setReceived((r) => (k === '⌫' ? r.slice(0, -1) : k === '.' && r.includes('.') ? r : r + k));
  const quick = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 20000) * 20000].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  const confirm = async () => {
    setErr(null);
    if (method === 'credit' && isCashCustomer) return setErr('البيع الآجل يحتاج اختيار عميل مسجل من السلة');
    if (method !== 'credit' && !box) return setErr(method === 'card' ? 'لا توجد خزينة بنكية/بطاقات. أضفها من «الخزائن والبنوك»' : 'لا توجد خزينة نقدية');
    if (method === 'cash' && recv < total) return setErr('المبلغ المستلم أقل من الإجمالي');
    setBusy(true);
    try {
      await onPaid(method, method === 'credit' ? null : box!, recv);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="الدفع" onClose={onClose}>
      <div className="stack">
        <div className="big-amount num">{formatMoney(total)}</div>
        {err && <Banner kind="err">{err}</Banner>}
        <div className="pay-methods" style={{ gridTemplateColumns: `repeat(${Math.min(boxes.length + (canCredit ? 1 : 0), 4)}, 1fr)` }}>
          {boxes.map((b) => (
            <button key={b.id} className={method !== 'credit' && box === b.id ? 'on' : ''} onClick={() => { setMethod(b.kind === 'bank' ? 'card' : 'cash'); setBoxId(b.id); }}>
              {b.kind === 'bank' ? <CreditCard /> : <Banknote />}
              {b.name}
            </button>
          ))}
          {canCredit && <button className={method === 'credit' ? 'on' : ''} onClick={() => setMethod('credit')}><Wallet />آجل</button>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {method === 'credit' && isCashCustomer && <Banner kind="warn">البيع الآجل يحتاج عميلًا: اختره أو أضف عميلًا جديدًا</Banner>}
          <CustomerFields partyId={party?.id ?? 'party-cash-customer'} onChange={onPickParty} layout="row" />
          {!isCashCustomer && <div className="footnote">{method === 'credit' ? `سيُسجل المبلغ دينًا على ${party.name} — رصيده الحالي ${formatMoney(party.balance ?? 0)}` : `الفاتورة تُحفظ في سجل ${party.name} بدون دين.`}</div>}
        </div>
        {method === 'cash' && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">المستلم</span>
              <span className="num bold" style={{ fontSize: 22 }}>{formatMoney(recv)}</span>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              {quick.map((v) => <button key={v} className="btn" style={{ flex: 1 }} onClick={() => setReceived(String(v / 100))}>{formatMoney(v)}</button>)}
            </div>
            <div className="keypad">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => <button key={k} onClick={() => key(k)}>{k}</button>)}
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 20 }}>
              <span>الباقي</span>
              <b className={`num ${change < 0 ? 'red' : 'green'}`}>{formatMoney(Math.max(change, 0))}</b>
            </div>
          </>
        )}
        {method === 'credit' && <div className="footnote">{isCashCustomer ? 'اختر العميل أعلاه.' : `سيُسجل المبلغ دينًا على ${party.name} (الرصيد الحالي ${formatMoney(party.balance ?? 0)}).`}</div>}
        <button className="btn success primary xl block" disabled={busy} onClick={confirm}><Check /> تأكيد البيع</button>
      </div>
    </Sheet>
  );
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
