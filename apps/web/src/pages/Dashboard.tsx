import { DOC_TYPES, formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, ClipboardCheck, Package, Receipt, ShoppingBag, ShoppingCart, TrendingUp, Undo2, Users, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DocStatusBadge } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, useSyncCounts } from '../lib/hooks';

export function Dashboard() {
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const counts = useSyncCounts();
  const today = todayISO();

  const data = useLiveQuery(async () => {
    const docs = await db.documents.where('date').equals(today).toArray();
    const sales = docs.filter((d) => (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return') && d.status === 'posted');
    const todaySales = sales.reduce((s, d) => s + (d.doc_type === 'sale_invoice' ? d.total : -d.total), 0);
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
    const recent = (await db.documents.orderBy('date').reverse().limit(60).toArray())
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, 8);
    const review = await db.documents.where('status').equals('pending_review').count();
    return { todaySales, todayCount: sales.length, cashboxes, receivables, payables, stockValue, reorder, recent, review };
  }, [today]);

  const actions = [
    { to: '/docs/new/sale_invoice', label: 'فاتورة بيع', icon: <ShoppingCart />, color: '#34C759', perm: 'sales.create' },
    { to: '/docs/new/sale_return', label: 'مرتجع بيع', icon: <Undo2 />, color: '#FF9500', perm: 'sales.create' },
    { to: '/docs/new/purchase_invoice', label: 'فاتورة شراء', icon: <ShoppingBag />, color: '#AF52DE', perm: 'purchases.create' },
    { to: '/docs/new/receipt', label: 'سند قبض', icon: <ArrowDownLeft />, color: '#30B0C7', perm: 'treasury.create' },
    { to: '/docs/new/payment', label: 'سند صرف', icon: <ArrowUpRight />, color: '#FF3B30', perm: 'treasury.create' },
    { to: '/docs/new/expense', label: 'مصروف', icon: <Receipt />, color: '#FF9500', perm: 'treasury.create' },
    { to: '/items', label: 'الأصناف', icon: <Package />, color: '#007AFF', perm: 'items.view' },
    { to: '/docs/new/stock_adjustment', label: 'جرد', icon: <ClipboardCheck />, color: '#FF2D55', perm: 'inventory.create' },
  ].filter((a) => can(a.perm));

  const hour = new Date().getHours();
  return (
    <div className="page">
      <PageHeader
        title={`${hour < 12 ? 'صباح الخير' : 'مساء الخير'}، ${session.user.full_name.split(' ')[0]}`}
        sub={new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {(counts.rejected > 0 || counts.conflicts > 0 || (data?.review ?? 0) > 0) && (
        <div style={{ marginBottom: 14, cursor: 'pointer' }} onClick={() => nav('/sync')}>
          <Banner kind="warn">
            يوجد {counts.rejected + counts.conflicts + (data?.review ?? 0)} عملية/مستند يحتاج مراجعة في مركز المزامنة. اضغط للمراجعة.
          </Banner>
        </div>
      )}

      <div className="grid grid-4">
        <Stat label="مبيعات اليوم" value={formatMoney(data?.todaySales ?? 0)} sub={`${data?.todayCount ?? 0} فاتورة`} icon={<TrendingUp />} color="#34C759" />
        {can('treasury.view') && (
          <Stat label="النقدية بالخزائن" value={formatMoney((data?.cashboxes ?? []).reduce((s, c) => s + (c.balance ?? 0), 0))} icon={<Wallet />} color="#007AFF" onClick={() => nav('/cashboxes')} />
        )}
        {can('parties.view') && <Stat label="مستحق من العملاء" value={formatMoney(data?.receivables ?? 0)} icon={<Users />} color="#5856D6" onClick={() => nav('/parties/customer')} />}
        {can('parties.view') && <Stat label="مستحق للموردين" value={formatMoney(data?.payables ?? 0)} icon={<ShoppingBag />} color="#AF52DE" onClick={() => nav('/parties/supplier')} />}
        {can('costs.view') && <Stat label="قيمة المخزون (بالتكلفة)" value={formatMoney(data?.stockValue ?? 0)} icon={<Boxes />} color="#FF9500" onClick={() => nav('/reports/stock')} />}
        {can('inventory.view') && (
          <Stat label="أصناف تحت حد الطلب" value={String(data?.reorder ?? 0)} icon={<AlertTriangle />} color={data?.reorder ? '#FF3B30' : '#8E8E93'} onClick={() => nav('/reports/reorder')} />
        )}
      </div>

      <div className="section-title">إجراءات سريعة</div>
      <div className="tiles">
        {actions.map((a) => (
          <button key={a.to} className="tile" onClick={() => nav(a.to)}>
            <span className="ti" style={{ background: a.color }}>{a.icon}</span>
            <span className="tt">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="section-title">آخر المستندات</div>
      {data?.recent.length ? (
        <div className="list">
          {data.recent.map((d) => (
            <div key={d.id} className="list-row tappable" onClick={() => nav(`/docs/view/${d.id}`)}>
              <div className="title">
                <div>
                  {DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label} <span className="num muted">{d.number ?? d.local_number}</span>
                </div>
                <div className="sub">{d.date}</div>
              </div>
              <DocStatusBadge status={d.status} sync={d._sync} />
              <div className="num bold">{formatMoney(d.total)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card pad muted">لا توجد مستندات بعد. ابدأ بإضافة الأصناف ثم فاتورة شراء أو بضاعة أول المدة.</div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon, color, onClick }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string; onClick?: () => void }) {
  return (
    <div className="card stat" style={{ cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <div className="row">
        <span className="stat-icon" style={{ background: color }}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value num" style={{ textAlign: 'start' }}>{value}</div>
      {sub && <div className="caption">{sub}</div>}
    </div>
  );
}
