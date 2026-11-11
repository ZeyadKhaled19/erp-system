import { DOC_TYPES, formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowDownLeft, CalendarClock, ChevronLeft, Package, Receipt, ShoppingBag, ShoppingCart, Truck, TrendingDown, TrendingUp, Users, Wallet, Zap,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocStatusBadge } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, useSyncCounts } from '../lib/hooks';

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
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const counts = useSyncCounts();
  const today = todayISO();
  const days = useMemo(() => lastDays(14), []);

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
    const qtyByItem = new Map<string, number>();
    balances.forEach((b) => qtyByItem.set(b.item_id, (qtyByItem.get(b.item_id) ?? 0) + b.qty));
    const items = await db.items.toArray();
    const reorder = items.filter((i) => i.active && i.reorder_level > 0 && (qtyByItem.get(i.id) ?? 0) <= i.reorder_level).length;
    const allSales = await db.documents.where('doc_type').equals('sale_invoice').toArray();
    const overdue = allSales.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid && d.due_date && d.due_date < today).length;
    const pendingDelivery = allSales.filter((d) => d.status === 'posted' && d.deliver_later).length;
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const dueSoon = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= todayISO(week)).length;
    const review = await db.documents.where('status').equals('pending_review').count();
    const recent = (await db.documents.orderBy('date').reverse().limit(80).toArray())
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, 6);
    return { series, todayCount, cashboxes, receivables, payables, stockValue, reorder, overdue, pendingDelivery, dueSoon, review, recent };
  }, [today, days]);

  const s = data?.series ?? [];
  const todaySales = s[s.length - 1] ?? 0;
  const yesterday = s[s.length - 2] ?? 0;
  const trend = yesterday ? Math.round(((todaySales - yesterday) * 100) / Math.abs(yesterday)) : null;
  const total14 = s.reduce((a, b) => a + b, 0);
  const cash = (data?.cashboxes ?? []).reduce((a, c) => a + (c.balance ?? 0), 0);

  const alerts = [
    { show: counts.rejected + counts.conflicts + (data?.review ?? 0) > 0, n: counts.rejected + counts.conflicts + (data?.review ?? 0), label: 'عمليات تحتاج مراجعة في المزامنة', to: '/sync', icon: <AlertTriangle />, grad: 'var(--grad-red)' },
    { show: (data?.overdue ?? 0) > 0 && can('sales.view'), n: data?.overdue ?? 0, label: 'فواتير آجلة متأخرة السداد', to: '/receivables', icon: <CalendarClock />, grad: 'var(--grad-orange)' },
    { show: (data?.dueSoon ?? 0) > 0 && can('treasury.view'), n: data?.dueSoon ?? 0, label: 'شيكات وأقساط مستحقة خلال أسبوع', to: '/instruments', icon: <CalendarClock />, grad: 'var(--grad-purple)' },
    { show: (data?.reorder ?? 0) > 0 && can('inventory.view'), n: data?.reorder ?? 0, label: 'أصناف وصلت لحد الطلب', to: '/reports/reorder', icon: <Package />, grad: 'var(--grad-red)' },
    { show: (data?.pendingDelivery ?? 0) > 0 && can('sales.view'), n: data?.pendingDelivery ?? 0, label: 'فواتير بانتظار التسليم', to: '/deliveries', icon: <Truck />, grad: 'var(--grad-brown)' },
  ].filter((a) => a.show);

  const actions = [
    { to: '/docs/new/purchase_invoice', label: 'فاتورة شراء', icon: <ShoppingBag />, grad: 'var(--grad-purple)', perm: 'purchases.create' },
    { to: '/docs/new/receipt', label: 'قبض من عميل', icon: <ArrowDownLeft />, grad: 'var(--grad-teal)', perm: 'treasury.create' },
    { to: '/docs/new/expense', label: 'مصروف', icon: <Receipt />, grad: 'var(--grad-orange)', perm: 'treasury.create' },
    { to: '/items', label: 'الأصناف', icon: <Package />, grad: 'var(--grad-blue)', perm: 'items.view' },
  ].filter((a) => can(a.perm));

  const hour = new Date().getHours();
  return (
    <div className="page">
      <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div className="page-sub" style={{ margin: 0 }}>{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <h1 className="large-title">{hour < 12 ? 'صباح الخير' : 'مساء الخير'}، {session.user.full_name.split(' ')[0]}</h1>
        </div>
      </div>

      <div className="tiles" style={{ marginBottom: 18 }}>
        {can('sales.create') && (
          <button className="tile hero green" onClick={() => nav('/pos')}>
            <span className="ti"><Zap /></span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="tt">بيع سريع</span>
              <span className="td">اختر الأصناف وادفع في خطوتين</span>
            </span>
          </button>
        )}
        {actions.map((a) => (
          <button key={a.to} className="tile" onClick={() => nav(a.to)}>
            <span className="ti" style={{ background: a.grad }}>{a.icon}</span>
            <span className="tt">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-4">
        <div className="card stat" style={{ gridColumn: 'span 2' }}>
          <div className="row">
            <span className="stat-icon" style={{ background: 'var(--grad-green)' }}><TrendingUp /></span>
            <span className="stat-label" style={{ flex: 1 }}>مبيعات اليوم · {data?.todayCount ?? 0} فاتورة</span>
            {trend !== null && (
              <span className={`trend ${trend >= 0 ? 'green' : 'red'}`}>
                {trend >= 0 ? <TrendingUp style={{ width: 14, height: 14 }} /> : <TrendingDown style={{ width: 14, height: 14 }} />} {Math.abs(trend)}% عن أمس
              </span>
            )}
          </div>
          <div className="stat-value num" style={{ textAlign: 'start' }}>{formatMoney(todaySales)}</div>
          <Bars values={s} labels={days} />
          <div className="caption">آخر 14 يومًا: <span className="num">{formatMoney(total14)}</span></div>
        </div>
        {can('treasury.view') && <Stat label="النقدية بالخزائن" value={cash} icon={<Wallet />} grad="var(--grad-blue)" onClick={() => nav('/cashboxes')} />}
        {can('parties.view') && <Stat label="مستحق من العملاء" value={data?.receivables ?? 0} icon={<Users />} grad="var(--grad-indigo)" onClick={() => nav('/parties/customer')} />}
        {can('parties.view') && <Stat label="مستحق للموردين" value={data?.payables ?? 0} icon={<ShoppingBag />} grad="var(--grad-purple)" onClick={() => nav('/parties/supplier')} />}
        {can('costs.view') && <Stat label="قيمة المخزون" value={data?.stockValue ?? 0} icon={<Package />} grad="var(--grad-orange)" onClick={() => nav('/reports/stock')} />}
      </div>

      {alerts.length > 0 && (
        <>
          <div className="section-title">يحتاج انتباهك</div>
          <div className="list">
            {alerts.map((a) => (
              <div key={a.to} className="list-row tappable with-icon" onClick={() => nav(a.to)}>
                <span className="sb-icon" style={{ background: a.grad, color: '#fff' }}>{a.icon}</span>
                <div className="title">{a.label}</div>
                <span className="badge solid-red">{a.n}</span>
                <ChevronLeft style={{ width: 18, height: 18, color: 'var(--label-3)' }} />
              </div>
            ))}
          </div>
        </>
      )}

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
      <div className="stat-value num" style={{ textAlign: 'start', fontSize: 26 }}>{formatMoney(value)}</div>
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
          <rect key={labels[i]} x={100 - (i + 1) * w + w * 0.18} y={34 - h} width={w * 0.64} height={h} rx={1.2} fill={last ? '#34C759' : v < 0 ? '#FF3B30' : 'rgba(52,199,89,.35)'}>
            <title>{`${labels[i]}: ${formatMoney(v)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
