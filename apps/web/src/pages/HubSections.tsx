import { DOC_TYPES, formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Boxes, CalendarClock, ClipboardCheck, FileClock, FileText, Package, PackageX, ShoppingBag, Truck, Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RowActions } from '../components/ListParts';
import { HUBS, type NavLink } from '../components/nav';
import { FollowUpPanel, QuickActions, ResponsiveSectionLayout, SectionCard, SectionHeader, SectionStats, type FollowUpItem, type SectionStat } from '../components/Section';
import { DocStatusBadge } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession } from '../lib/hooks';

/** روابط مجموعة من أقسام الشريط (للمتابعة)، مفلترة بالصلاحيات */
function useHubLinks(hubKey: string, titles: string[]) {
  const can = usePerm();
  const hub = HUBS.find((h) => h.key === hubKey);
  return (hub?.groups ?? []).filter((g) => titles.includes(g.title)).flatMap((g) => g.links).filter((l) => !l.perm || can(l.perm));
}
const toFollow = (links: NavLink[], counts: Record<string, { count: number; tone: FollowUpItem['tone']; title?: string }> = {}): FollowUpItem[] =>
  links.map((l) => ({ key: l.to, label: l.label, icon: l.icon, to: l.to, ...(counts[l.to] ?? {}) }));

/** جدول آخر المستندات داخل كارت (الضغط على السطر يفتح المستند، والقلم للمسودات فقط) */
function RecentDocs({ title, icon, moreTo, docs, partyHead, module, typeCol, empty }: { title: string; icon: ReactNode; moreTo?: string; docs: any[]; partyHead: string; module: string; typeCol?: boolean; empty: string }) {
  const nav = useNavigate();
  const can = usePerm();
  return (
    <SectionCard icon={icon} title={title} moreTo={moreTo}>
      <div className="sx-table">
        {docs.length === 0 ? <div className="sx-empty">{empty}</div> : (
          <table className="table responsive">
            <thead><tr><th>الرقم</th><th>التاريخ</th>{typeCol && <th>النوع</th>}<th>{partyHead}</th><th className="n">الإجمالي</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => {
                const editable = (d.status === 'draft' || d.status === 'pending_review' || d._sync === 'rejected') && can(`${module}.create`);
                return (
                  <tr key={d.id} onClick={() => nav(`/docs/view/${d.id}`)}>
                    <td data-label="الرقم" className="num bold">{d.number ?? d.local_number ?? '—'}</td>
                    <td data-label="التاريخ" className="num">{d.date}</td>
                    {typeCol && <td data-label="النوع">{DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label ?? d.doc_type}</td>}
                    <td data-label={partyHead}>{d.party}</td>
                    <td data-label="الإجمالي" className="n bold">{formatMoney(d.total ?? d.amount ?? 0)}</td>
                    <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                    <td data-label="" className="lp-act-cell"><RowActions openLabel="عرض المستند" onOpen={() => nav(`/docs/view/${d.id}`)} onEdit={editable ? () => nav(`/docs/edit/${d.id}`) : undefined} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );
}

const newest = (a: any, b: any) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date));

// =====================================================================================
// المشتريات
// =====================================================================================
export function PurchasesSection() {
  const can = usePerm();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const today = todayISO();
  const month = today.slice(0, 7) + '-01';
  const data = useLiveQuery(async () => {
    const stats: SectionStat[] = [];
    let recent: any[] = [];
    let owedSuppliers = 0;
    let reorder = 0;
    const parties = await db.parties.where('kind').equals('supplier').toArray();
    const name = new Map(parties.map((p) => [p.id, p.name]));
    if (can('purchases.view')) {
      const inv = await db.documents.where('doc_type').equals('purchase_invoice').toArray();
      const monthDocs = (await db.documents.where('date').between(month, today, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'purchase_invoice' || d.doc_type === 'purchase_return'));
      const sign = (d: any) => (d.doc_type === 'purchase_invoice' ? d.total : -d.total);
      const todayDocs = monthDocs.filter((d) => d.date === today);
      const open = inv.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid);
      stats.push({ key: 'today', label: 'مشتريات اليوم', value: formatMoney(todayDocs.reduce((s, d) => s + sign(d), 0)), sub: `${todayDocs.filter((d) => d.doc_type === 'purchase_invoice').length} فاتورة`, icon: <ShoppingBag />, color: 'purple', to: '/docs/list/purchases' });
      stats.push({ key: 'month', label: 'مشتريات الشهر', value: formatMoney(monthDocs.reduce((s, d) => s + sign(d), 0)), sub: 'بعد المرتجعات', icon: <BarChart3 />, color: 'blue', to: '/docs/list/purchases' });
      stats.push({ key: 'open', label: 'فواتير شراء آجلة', value: open.length, sub: open.length ? `الباقي ${formatMoney(open.reduce((s, d) => s + (d.total - d.paid), 0))}` : 'كله مسدد', icon: <FileClock />, color: 'orange', to: '/docs/list/purchases' });
      recent = inv.sort(newest).slice(0, 6).map((d) => ({ ...d, party: d.party_id ? name.get(d.party_id) ?? '—' : 'مورد نقدي' }));
    }
    if (can('parties.view')) {
      const due = parties.filter((p) => (p.balance ?? 0) > 0.005);
      owedSuppliers = due.length;
      stats.push({ key: 'due', label: 'مستحقات الموردين', value: formatMoney(due.reduce((s, p) => s + p.balance, 0)), sub: `${due.length} مورد`, icon: <Truck />, color: 'teal', to: '/parties/supplier' });
    }
    if (can('inventory.view')) {
      const qty = new Map<string, number>();
      (await db.stock_balances.toArray()).forEach((b) => qty.set(b.item_id, (qty.get(b.item_id) ?? 0) + b.qty));
      reorder = (await db.items.toArray()).filter((i) => i.active !== false && !i.is_service && i.reorder_level > 0 && (qty.get(i.id) ?? 0) <= i.reorder_level).length;
    }
    return { stats, recent, owedSuppliers, reorder };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, permsKey]);
  const follow = toFollow(useHubLinks('purchases', ['المتابعة']), { '/parties/supplier': { count: data?.owedSuppliers ?? 0, tone: 'blue', title: 'موردين ليهم مستحقات' } });
  if (can('inventory.view')) follow.push({ key: 'reorder', label: 'أصناف تحت حد الطلب', icon: <AlertTriangle />, to: '/reports/reorder', count: data?.reorder ?? 0, tone: 'orange' });
  return (
    <div className="page sx-page">
      <SectionHeader icon={<ShoppingBag />} color="purple" title="المشتريات" sub="فواتير الشراء والمرتجعات ومستحقات الموردين" />
      <SectionStats items={data?.stats ?? []} />
      <QuickActions section="purchases" defaults={['purchase_invoice', 'purchase_return', 'payment', 'supplier_new', 'item_new', 'expense']} />
      <ResponsiveSectionLayout
        side={<FollowUpPanel icon={<ClipboardCheck />} items={follow} />}
        main={can('purchases.view') && <RecentDocs title="آخر فواتير المشتريات" icon={<FileText />} moreTo="/docs/list/purchases" docs={data?.recent ?? []} partyHead="المورد" module="purchases" empty="لسه مفيش فواتير شراء." />}
      />
    </div>
  );
}

// =====================================================================================
// المخزون
// =====================================================================================
export function InventorySection() {
  const can = usePerm();
  const nav = useNavigate();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const data = useLiveQuery(async () => {
    const stats: SectionStat[] = [];
    let short: any[] = [];
    let moves: any[] = [];
    let pendingDelivery = 0;
    const items = (await db.items.toArray()).filter((i) => i.active !== false);
    if (can('items.view')) stats.push({ key: 'items', label: 'الأصناف النشطة', value: items.length, sub: `${items.filter((i) => i.is_service).length} خدمة`, icon: <Package />, color: 'orange', to: '/items' });
    if (can('inventory.view')) {
      const balances = await db.stock_balances.toArray();
      const qty = new Map<string, number>();
      balances.forEach((b) => qty.set(b.item_id, (qty.get(b.item_id) ?? 0) + b.qty));
      const goods = items.filter((i) => !i.is_service);
      const negative = goods.filter((i) => (qty.get(i.id) ?? 0) < 0);
      const out = goods.filter((i) => (qty.get(i.id) ?? 0) === 0);
      const low = goods.filter((i) => i.reorder_level > 0 && (qty.get(i.id) ?? 0) > 0 && (qty.get(i.id) ?? 0) <= i.reorder_level);
      stats.push({ key: 'low', label: 'تحت حد الطلب', value: low.length, icon: <AlertTriangle />, color: 'orange', valueTone: low.length ? 'orange' : undefined, to: '/reports/reorder' });
      stats.push({ key: 'out', label: 'نفدت من المخزون', value: out.length, icon: <PackageX />, color: 'red', valueTone: out.length ? 'red' : undefined, to: '/reports/stock' });
      stats.push({ key: 'neg', label: 'أرصدة سالبة', value: negative.length, sub: negative.length ? 'محتاجة جرد' : 'مفيش', icon: <AlertTriangle />, color: 'pink', valueTone: negative.length ? 'red' : undefined, to: '/reports/negative' });
      if (can('costs.view')) stats.push({ key: 'value', label: 'قيمة المخزون', value: formatMoney(balances.reduce((s, b) => s + (b.value ?? 0), 0)), sub: 'بالتكلفة', icon: <Boxes />, color: 'green', valueTone: 'green', to: '/reports/stock' });
      short = [...negative, ...out, ...low].slice(0, 8).map((i) => ({ ...i, qty: qty.get(i.id) ?? 0 }));
      const whs = new Map((await db.warehouses.toArray()).map((w) => [w.id, w.name]));
      moves = (await db.documents.where('doc_type').anyOf(['stock_transfer', 'stock_adjustment', 'opening_stock']).toArray()).sort(newest).slice(0, 5)
        .map((d) => ({ ...d, party: d.doc_type === 'stock_transfer' ? `${whs.get(d.warehouse_id) ?? '—'} ← ${whs.get(d.to_warehouse_id) ?? '—'}` : whs.get(d.warehouse_id) ?? '—' }));
    }
    if (can('sales.view')) pendingDelivery = (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter((d) => d.status === 'posted' && d.deliver_later).length;
    return { stats, short, moves, pendingDelivery };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsKey]);
  const follow = toFollow([...useHubLinks('inventory', ['الأصناف']), ...useHubLinks('inventory', ['حركات المخزن']).filter((l) => !l.to.startsWith('/docs/new/'))]);
  if (can('sales.view')) follow.push({ key: 'deliveries', label: 'بانتظار التسليم', icon: <Truck />, to: '/deliveries', count: data?.pendingDelivery ?? 0, tone: 'blue' });
  const reports = toFollow(useHubLinks('inventory', ['تقارير المخزون']));
  return (
    <div className="page sx-page">
      <SectionHeader icon={<Package />} color="orange" title="المخزون" sub="الأصناف والأرصدة والجرد والتحويلات" />
      <SectionStats items={data?.stats ?? []} />
      <QuickActions section="inventory" defaults={['item_new', 'stock_adjustment', 'stock_transfer', 'item_inquiry', 'purchase_invoice', 'opening_stock']} />
      <ResponsiveSectionLayout
        side={<>
          <FollowUpPanel icon={<ClipboardCheck />} items={follow} />
          {reports.length > 0 && <FollowUpPanel title="تقارير المخزون" icon={<BarChart3 />} items={reports} />}
        </>}
        main={can('inventory.view') && <>
          <SectionCard icon={<AlertTriangle />} color="orange" title="النواقص والأرصدة السالبة" moreTo="/reports/reorder">
            <div className="sx-table">
              {!data || data.short.length === 0 ? <div className="sx-empty">مفيش نواقص دلوقتي.</div> : (
                <table className="table responsive">
                  <thead><tr><th>الكود</th><th>الصنف</th><th className="n">الرصيد</th><th className="n">حد الطلب</th><th>الحالة</th></tr></thead>
                  <tbody>
                    {data.short.map((i) => (
                      <tr key={i.id} onClick={() => nav(`/items/inquiry?id=${i.id}`)}>
                        <td data-label="الكود" className="num">{i.code}</td>
                        <td data-label="الصنف" className="bold">{i.name}</td>
                        <td data-label="الرصيد" className={`n bold ${i.qty < 0 ? 'red' : ''}`}>{formatQty(i.qty)}</td>
                        <td data-label="حد الطلب" className="n">{i.reorder_level ? formatQty(i.reorder_level) : '—'}</td>
                        <td data-label="الحالة"><span className={`badge ${i.qty < 0 ? 'red' : i.qty === 0 ? 'red' : 'orange'}`}>{i.qty < 0 ? 'رصيد سالب' : i.qty === 0 ? 'نفد' : 'تحت حد الطلب'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </SectionCard>
          <RecentDocs title="آخر حركات المخازن" icon={<FileText />} moreTo="/docs/list/inventory" docs={data?.moves ?? []} partyHead="المخزن" module="inventory" typeCol empty="لسه مفيش تحويلات أو جرد." />
        </>}
      />
    </div>
  );
}

// =====================================================================================
// الخزينة
// =====================================================================================
const TREASURY_TYPES = ['receipt', 'payment', 'expense', 'income', 'cash_transfer'];
export function TreasurySection() {
  const can = usePerm();
  const nav = useNavigate();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const today = todayISO();
  const data = useLiveQuery(async () => {
    const stats: SectionStat[] = [];
    const boxes = (await db.cashboxes.toArray()).filter((c) => c.active !== false);
    const docs = await db.documents.where('doc_type').anyOf(TREASURY_TYPES).toArray();
    const posted = docs.filter((d) => d.status === 'posted' && d.date === today);
    const inToday = posted.filter((d) => d.doc_type === 'receipt' || d.doc_type === 'income').reduce((s, d) => s + (d.total ?? d.amount ?? 0), 0);
    const outToday = posted.filter((d) => d.doc_type === 'payment' || d.doc_type === 'expense').reduce((s, d) => s + (d.total ?? d.amount ?? 0), 0);
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const due = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= todayISO(week));
    stats.push({ key: 'cash', label: 'النقدية بالخزائن والبنوك', value: formatMoney(boxes.reduce((s, c) => s + (c.balance ?? 0), 0)), sub: `${boxes.length} خزينة`, icon: <Wallet />, color: 'blue', to: '/cashboxes' });
    stats.push({ key: 'in', label: 'مقبوضات اليوم', value: formatMoney(inToday), icon: <ArrowDownLeft />, color: 'green', valueTone: 'green', to: '/docs/list/treasury' });
    stats.push({ key: 'out', label: 'مدفوعات اليوم', value: formatMoney(outToday), sub: 'صرف ومصروفات', icon: <ArrowUpRight />, color: 'red', to: '/docs/list/treasury' });
    stats.push({ key: 'due', label: 'شيكات وأقساط خلال أسبوع', value: due.length, icon: <CalendarClock />, color: 'purple', valueTone: due.length ? 'orange' : undefined, to: '/instruments' });
    const parties = new Map((await db.parties.toArray()).map((p) => [p.id, p.name]));
    const boxName = new Map(boxes.map((b) => [b.id, b.name]));
    const recent = docs.sort(newest).slice(0, 6).map((d) => ({ ...d, party: (d.party_id && parties.get(d.party_id)) || boxName.get(d.cashbox_id) || '—' }));
    return { stats, recent, boxes, due: due.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, permsKey]);
  const follow = toFollow(useHubLinks('treasury', ['المتابعة']), { '/instruments': { count: data?.due ?? 0, tone: 'orange', title: 'مستحقة خلال أسبوع' } });
  return (
    <div className="page sx-page">
      <SectionHeader icon={<Wallet />} color="blue" title="الخزائن والحسابات" sub="القبض والصرف والمصروفات وأرصدة الخزائن" />
      <SectionStats items={data?.stats ?? []} />
      <QuickActions section="treasury" defaults={['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'shift']} />
      <ResponsiveSectionLayout
        side={<>
          <FollowUpPanel icon={<ClipboardCheck />} items={follow} />
          {data && data.boxes.length > 0 && (
            <SectionCard icon={<Wallet />} title="أرصدة الخزائن" moreTo="/cashboxes">
              <div className="sx-follow-list">
                {data.boxes.map((b) => (
                  <button key={b.id} type="button" className="sx-follow-row" onClick={() => can('reports.financial') ? nav(`/reports/ledger?account=${b.account_id}`) : nav('/cashboxes')}>
                    <span className="sx-follow-ic"><Wallet /></span>
                    <span className="sx-follow-l">{b.name}</span>
                    <b className={`num ${(b.balance ?? 0) < 0 ? 'red' : ''}`}>{formatMoney(b.balance ?? 0)}</b>
                  </button>
                ))}
              </div>
            </SectionCard>
          )}
        </>}
        main={<RecentDocs title="آخر السندات" icon={<FileText />} moreTo="/docs/list/treasury" docs={data?.recent ?? []} partyHead="الطرف / الخزينة" module="treasury" typeCol empty="لسه مفيش سندات قبض أو صرف." />}
      />
    </div>
  );
}

