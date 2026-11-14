import { DOC_TYPES, formatMoney, hasPermission, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft, Fingerprint, CalendarClock, CalendarDays, Check, ChevronLeft, ClipboardList, Clock3, FileText, Package, PackagePlus, RotateCcw, ShieldAlert, ShoppingBag, ShoppingBasket, ShoppingCart, SlidersHorizontal, Star, Truck, TrendingDown, TrendingUp, Users, Wallet, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocStatusBadge } from '../components/ui';
import { SECTIONS } from '../components/nav';
import { db } from '../lib/db';
import { useWorkCounts } from '../lib/alerts';
import { QUICK_ACTIONS, recordUse } from '../lib/quickActions';
import { usePerm, useSession, useSettings } from '../lib/hooks';

const dayKey = (d: Date) => todayISO(d);
function lastDays(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(dayKey(x));
  }
  return out;
}

export function Dashboard() {
  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'الرئيسية';
    document.title = 'الرئيسية — الحسابات';
  }, []);
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const settings = useSettings();
  const today = todayISO();
  const days = useMemo(() => lastDays(14), []);

  const perms = session.user.permissions;
  const data = useLiveQuery(async () => {
    const docs = await db.documents.where('date').between(days[0], today, true, true).toArray();
    const salesBy = new Map<string, number>(days.map((d) => [d, 0]));
    let todayCount = 0;
    for (const d of docs) {
      if (d.status !== 'posted' || (d.doc_type !== 'sale_invoice' && d.doc_type !== 'sale_return')) continue;
      const v = d.doc_type === 'sale_invoice' ? d.total : -d.total;
      salesBy.set(d.date, (salesBy.get(d.date) ?? 0) + v);
      if (d.date === today && d.doc_type === 'sale_invoice') todayCount++;
    }
    const series = days.map((d) => salesBy.get(d) ?? 0);
    const cashboxes = (await db.cashboxes.toArray()).filter((c) => c.active);
    const parties = await db.parties.toArray();
    const receivables = parties.filter((p) => p.kind === 'customer').reduce((s, p) => s + (p.balance ?? 0), 0);
    const payables = parties.filter((p) => p.kind === 'supplier').reduce((s, p) => s + (p.balance ?? 0), 0);
    const balances = await db.stock_balances.toArray();
    const stockValue = balances.reduce((s, b) => s + (b.value ?? 0), 0);
    const recent = (await db.documents.orderBy('date').reverse().limit(200).toArray())
      .filter((d) => { const m = DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.module; return !!m && hasPermission(perms, `${m}.view`); })
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, 6);
    return { series, todayCount, cashboxes, receivables, payables, stockValue, recent };
  }, [today, days, perms.join(',')]);

  const s = data?.series ?? [];
  const todaySales = s[s.length - 1] ?? 0;
  const yesterday = s[s.length - 2] ?? 0;
  const trend = yesterday ? Math.round(((todaySales - yesterday) * 100) / Math.abs(yesterday)) : null;
  const total14 = s.reduce((a, b) => a + b, 0);
  const cash = (data?.cashboxes ?? []).reduce((a, c) => a + (c.balance ?? 0), 0);

  return (
    <div className="page mc-home">
      <HomeHeader name={session.user.full_name} company={settings.company_name || ''} />

      <div className="mc-cards" role="list">
        {SECTIONS.filter((x) => !x.perms.length || x.perms.some((p) => can(p))).map((x) => (
          <button key={x.key} type="button" role="listitem" className={`mc-card mc-${x.color} ${x.key === 'home' ? 'on' : ''}`} aria-current={x.key === 'home' ? 'page' : undefined} onClick={() => nav(x.to)}>
            <span className="mc-card-ic">{x.cardIcon}</span>
            <span className="mc-card-l">{x.label}</span>
          </button>
        ))}
      </div>

      <div className="mc-panels">
        <QuickTasks />
        <Favorites />
      </div>

      <div className="section-title mc-more-title">ملخص اليوم</div>
      <div className="grid grid-3 dash-stats">
        {can('sales.view') && <div className="card stat" style={{ gridColumn: 'span 2' }}>
          <div className="row">
            <span className="stat-icon" style={{ background: 'var(--grad-green)' }}><TrendingUp /></span>
            <span className="stat-label" style={{ flex: 1 }}>مبيعات اليوم · {data?.todayCount ?? 0} فاتورة</span>
            {trend !== null && (
              <span className={`trend ${trend >= 0 ? 'green' : 'red'}`}>
                {trend >= 0 ? <TrendingUp style={{ width: 14, height: 14 }} /> : <TrendingDown style={{ width: 14, height: 14 }} />} {Math.abs(trend)}% عن أمس
              </span>
            )}
          </div>
          <div className="stat-value num">{formatMoney(todaySales)}</div>
          <Bars values={s} labels={days} />
          <div className="caption">آخر 14 يومًا: <span className="num">{formatMoney(total14)}</span></div>
        </div>}
        {can('treasury.view') && <Stat label="النقدية بالخزائن" value={cash} icon={<Wallet />} grad="var(--grad-blue)" onClick={() => nav('/cashboxes')} />}
        {can('parties.view') && <Stat label="مستحق من العملاء" value={data?.receivables ?? 0} icon={<Users />} grad="var(--grad-indigo)" onClick={() => nav('/parties/customer')} />}
        {can('parties.view') && <Stat label="مستحق للموردين" value={data?.payables ?? 0} icon={<ShoppingBag />} grad="var(--grad-purple)" onClick={() => nav('/parties/supplier')} />}
        {can('costs.view') && <Stat label="قيمة المخزون" value={data?.stockValue ?? 0} icon={<Package />} grad="var(--grad-orange)" onClick={() => nav('/reports/stock')} />}
      </div>


      <div className="section-title">آخر العمليات</div>
      {data?.recent.length ? (
        <div className="list">
          {data.recent.map((d) => (
            <div key={d.id} className="list-row tappable with-icon" onClick={() => nav(`/docs/view/${d.id}`)}>
              <span className="sb-icon" style={{ background: d.doc_type.startsWith('sale') ? 'var(--grad-green)' : d.doc_type.startsWith('purchase') ? 'var(--grad-purple)' : 'var(--grad-blue)', color: '#fff' }}>
                {d.doc_type.startsWith('sale') ? <ShoppingCart /> : d.doc_type.startsWith('purchase') ? <ShoppingBag /> : <Wallet />}
              </span>
              <div className="title">
                {DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label} <span className="num muted">{d.number ?? d.local_number}</span>
                <div className="sub num">{d.date}</div>
              </div>
              <DocStatusBadge status={d.status} sync={d._sync} />
              <div className="num bold">{formatMoney(d.total)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card pad muted">لا توجد عمليات بعد. ابدأ بإضافة الأصناف، ثم فاتورة شراء أو «بيع سريع».</div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, grad, onClick }: { label: string; value: number; icon: React.ReactNode; grad: string; onClick?: () => void }) {
  return (
    <div className="card stat" style={{ cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <div className="row">
        <span className="stat-icon" style={{ background: grad }}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value num" style={{ fontSize: 28 }}>{formatMoney(value)}</div>
    </div>
  );
}

/** رسم أعمدة بسيط لمبيعات الأيام الأخيرة */
function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const w = 100 / Math.max(values.length, 1);
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: '100%', height: 64 }} role="img" aria-label="مبيعات آخر 14 يومًا">
      {values.map((v, i) => {
        const h = Math.max(1.5, (Math.abs(v) / max) * 30);
        const last = i === values.length - 1;
        return (
          <rect key={labels[i]} x={100 - (i + 1) * w + w * 0.18} y={34 - h} width={w * 0.64} height={h} rx={1.2} fill={last ? 'var(--tint)' : v < 0 ? 'var(--red)' : 'var(--tint-soft)'} stroke={last || v < 0 ? 'none' : 'var(--tint-ring)'} strokeWidth={0.3}>
            <title>{`${labels[i]}: ${formatMoney(v)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** «مرحبًا بك، الاسم 👋» + سطر الشركة، وكبسولة التاريخ والوقت (تتحدث كل نصف دقيقة) */
function HomeHeader({ name, company }: { name: string; company: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const date = now.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="mc-hello">
      <div className="mc-hello-t">
        <h1>
          <span className="mc-wave" aria-hidden="true">👋</span>
          مرحبًا بك، <span className="mc-hello-n">{name}</span>
        </h1>
        {company && <div className="mc-hello-s">في نظام إدارة الأعمال {company}</div>}
      </div>
      <div className="mc-when">
        <span><CalendarDays /> {date}</span>
        <i aria-hidden="true" />
        <span className="num"><Clock3 /> {time}</span>
      </div>
    </div>
  );
}

/** «مهامي السريعة»: أرقام حقيقية من بيانات الجهاز، وكل سطر يظهر لمن يملك صلاحيته */
function QuickTasks() {
  const nav = useNavigate();
  const can = usePerm();
  const w = useWorkCounts();
  const rows: { show: boolean; n: number; label: string; to: string; icon: ReactNode; tone: string; title?: string; always?: boolean }[] = [
    { show: can('sales.view'), n: w.overdue, label: 'فواتير تحتاج متابعة', to: '/receivables', icon: <FileText />, tone: 'red', title: 'فواتير بيع آجلة عدّى ميعاد سدادها', always: true },
    { show: can('inventory.view'), n: w.reorder, label: 'أصناف تحت حد الطلب', to: '/reports/reorder', icon: <Package />, tone: 'orange', always: true },
    { show: can('parties.view'), n: w.customers, label: 'مستحقات على العملاء', to: '/parties/customer', icon: <Users />, tone: 'blue', title: `إجمالي المستحق: ${formatMoney(w.customersAmount)}`, always: true },
    { show: can('parties.view'), n: w.suppliers, label: 'مستحقات للموردين', to: '/parties/supplier', icon: <Truck />, tone: 'blue', title: `إجمالي المستحق: ${formatMoney(w.suppliersAmount)}`, always: true },
    { show: true, n: w.review, label: 'عمليات تحتاج مراجعة', to: '/sync', icon: <ShieldAlert />, tone: 'red' },
    { show: can('treasury.view'), n: w.dueSoon, label: 'شيكات وأقساط مستحقة خلال أسبوع', to: '/instruments', icon: <CalendarClock />, tone: 'orange' },
    { show: can('sales.view'), n: w.pendingDelivery, label: 'فواتير بانتظار التسليم', to: '/deliveries', icon: <Truck />, tone: 'blue' },
  ];
  const list = rows.filter((r) => r.show && (r.always || r.n > 0));
  return (
    <section className="mc-panel mc-tasks" aria-labelledby="mc-tasks-t">
      <div className="mc-panel-h">
        <h2 id="mc-tasks-t"><ClipboardList className="mc-panel-ic" /> مهامي السريعة</h2>
      </div>
      {list.length ? (
        <div className="mc-task-list">
          {list.map((r) => (
            <button key={r.label} type="button" className="mc-task" title={r.title} onClick={() => nav(r.to)}>
              <span className="mc-task-ic">{r.icon}</span>
              <span className="mc-task-l">{r.label}</span>
              <span className={`mc-count ${r.tone} num`}>{r.n}</span>
              <ChevronLeft className="mc-chev" />
            </button>
          ))}
        </div>
      ) : (
        <div className="mc-empty">مفيش مهام تخص صلاحياتك دلوقتي.</div>
      )}
    </section>
  );
}

/** أيقونات وأسماء المفضلة (الباقي يستخدم أيقونة واسم الإجراء نفسه) */
const FAV_ICONS: Record<string, ReactNode> = {
  sale_invoice: <ShoppingCart />, purchase_invoice: <ShoppingBasket />, item_new: <PackagePlus />, receipt: <ArrowDownLeft />, pos: <Zap />,
  purchase_return: <RotateCcw />, payment: <Wallet />, attendance: <Fingerprint />,
};
const FAV_LABEL: Record<string, string> = {
  sale_invoice: 'فاتورة بيع جديدة', purchase_invoice: 'فاتورة شراء جديدة', item_new: 'إضافة صنف جديد',
};
/** الافتراضي؛ ونكمل للأربعة من الباقي حسب صلاحيات المستخدم */
const FAV_DEFAULT = ['sale_invoice', 'purchase_invoice', 'item_new', 'attendance', 'receipt', 'pos', 'payment', 'expense', 'customer_new'];
const favKey = (uid: string) => `erp.favorites.v1.${uid}`;
function readFavs(uid: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(favKey(uid)) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** «اختصاراتي المفضلة»: 4 أزرار، الأول أزرق ممتلئ، و«تخصيص» يحفظ اختيار كل مستخدم على الجهاز */
function Favorites() {
  const nav = useNavigate();
  const { session } = useSession();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const available = useMemo(() => QUICK_ACTIONS.filter((a) => hasPermission(perms, a.perm)), [perms]);
  const [saved, setSaved] = useState<string[] | null>(() => readFavs(uid));
  useEffect(() => setSaved(readFavs(uid)), [uid]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const pick = (keys: string[]) => keys.map((k) => available.find((a) => a.key === k)).filter((a): a is (typeof available)[number] => !!a);
  const chosen = (saved ? pick(saved) : pick(FAV_DEFAULT)).slice(0, 4);
  const startEdit = () => {
    setDraft(chosen.map((a) => a.key));
    setEditing(true);
  };
  const toggle = (k: string) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : d.length >= 4 ? d : [...d, k]));
  const save = () => {
    try {
      localStorage.setItem(favKey(uid), JSON.stringify(draft));
    } catch {
      /* التخزين غير متاح: يُحفظ للجلسة الحالية فقط */
    }
    setSaved(draft);
    setEditing(false);
  };
  return (
    <section className="mc-panel mc-favs" aria-labelledby="mc-favs-t">
      <div className="mc-panel-h">
        <h2 id="mc-favs-t"><Star className="mc-star" /> اختصاراتي المفضلة</h2>
        {available.length > 0 && (editing ? (
          <span className="mc-fav-tools">
            <button type="button" className="mc-chip" onClick={() => setEditing(false)}>إلغاء</button>
            <button type="button" className="mc-chip primary" onClick={save} disabled={!draft.length}><Check /> حفظ</button>
          </span>
        ) : (
          <button type="button" className="mc-chip" onClick={startEdit}><SlidersHorizontal /> تخصيص</button>
        ))}
      </div>
      {editing ? (
        <div className="mc-fav-pick">
          <div className="mc-fav-hint">اختار لحد 4 اختصارات بالترتيب ({draft.length}/4) — الأول بيظهر أزرق.</div>
          <div className="mc-fav-opts">
            {available.map((a) => {
              const i = draft.indexOf(a.key);
              return (
                <button key={a.key} type="button" className={`mc-fav-opt ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(a.key)} disabled={i < 0 && draft.length >= 4}>
                  {i >= 0 && <b className="num">{i + 1}</b>}
                  <span className="mc-fav-ic">{FAV_ICONS[a.key] ?? a.icon}</span>
                  {FAV_LABEL[a.key] ?? a.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : chosen.length ? (
        <div className="mc-fav-grid">
          {chosen.map((a, i) => (
            <button key={a.key} type="button" className={`mc-fav ${i === 0 ? 'primary' : ''} fav-${a.key}`} onClick={() => { recordUse(uid, a.key); nav(a.to); }}>
              <span className="mc-fav-ic">{FAV_ICONS[a.key] ?? a.icon}</span>
              <span>{FAV_LABEL[a.key] ?? a.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mc-empty">مفيش اختصارات متاحة لصلاحياتك.</div>
      )}
    </section>
  );
}
