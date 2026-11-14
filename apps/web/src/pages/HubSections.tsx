import { DOC_TYPES, formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, BookOpen, Boxes, CalendarClock, CheckCircle2, ClipboardCheck, CloudOff, FileClock, FileText, Package, PackageX, RefreshCw, Settings,
  ShoppingBag, ShoppingCart, Truck, UserCircle, Users, Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RowActions } from '../components/ListParts';
import { HUBS, type NavLink } from '../components/nav';
import { FollowUpPanel, LinkGrid, QuickActions, ResponsiveSectionLayout, SectionCard, SectionHeader, SectionStats, pctChange, prevSpans, type FollowUpItem, type SectionLink, type SectionStat } from '../components/Section';
import { DocStatusBadge } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, useSyncCounts, useSyncState } from '../lib/hooks';

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
      const ps = prevSpans(today);
      const span = (await db.documents.where('date').between(ps.pmFrom, today, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'purchase_invoice' || d.doc_type === 'purchase_return'));
      const monthDocs = span.filter((d) => d.date >= month);
      const sign = (d: any) => (d.doc_type === 'purchase_invoice' ? d.total : -d.total);
      const total = (xs: any[]) => xs.reduce((s, d) => s + sign(d), 0);
      const todayDocs = monthDocs.filter((d) => d.date === today);
      const yDocs = span.filter((d) => d.date === ps.yesterday);
      const pmDocs = span.filter((d) => d.date >= ps.pmFrom && d.date <= ps.pmTo);
      const open = inv.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid);
      stats.push({ key: 'today', label: 'مشتريات اليوم', value: formatMoney(total(todayDocs)), sub: `${todayDocs.filter((d) => d.doc_type === 'purchase_invoice').length} فاتورة`, change: { pct: pctChange(total(todayDocs), total(yDocs)), vs: 'عن امبارح', invert: true }, icon: <ShoppingBag />, color: 'purple', to: '/docs/list/purchases' });
      stats.push({ key: 'month', label: 'مشتريات الشهر', value: formatMoney(total(monthDocs)), sub: 'بعد المرتجعات', change: { pct: pctChange(total(monthDocs), total(pmDocs)), vs: 'عن الشهر اللي فات', invert: true }, icon: <BarChart3 />, color: 'blue', to: '/docs/list/purchases' });
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
    const { yesterday } = prevSpans(today);
    const sumOf = (day: string, types: string[]) => docs.filter((d) => d.status === 'posted' && d.date === day && types.includes(d.doc_type)).reduce((s, d) => s + (d.total ?? d.amount ?? 0), 0);
    const inToday = sumOf(today, ['receipt', 'income']);
    const outToday = sumOf(today, ['payment', 'expense']);
    const inY = sumOf(yesterday, ['receipt', 'income']);
    const outY = sumOf(yesterday, ['payment', 'expense']);
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const due = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= todayISO(week));
    stats.push({ key: 'cash', label: 'النقدية بالخزائن والبنوك', value: formatMoney(boxes.reduce((s, c) => s + (c.balance ?? 0), 0)), sub: `${boxes.length} خزينة`, icon: <Wallet />, color: 'blue', to: '/cashboxes' });
    stats.push({ key: 'in', label: 'مقبوضات اليوم', value: formatMoney(inToday), change: { pct: pctChange(inToday, inY), vs: 'عن امبارح' }, icon: <ArrowDownLeft />, color: 'green', valueTone: 'green', to: '/docs/list/treasury' });
    stats.push({ key: 'out', label: 'مدفوعات اليوم', value: formatMoney(outToday), sub: 'صرف ومصروفات', change: { pct: pctChange(outToday, outY), vs: 'عن امبارح', invert: true }, icon: <ArrowUpRight />, color: 'red', to: '/docs/list/treasury' });
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

const toLinks = (links: NavLink[]): SectionLink[] => links.map((l) => ({ key: l.to, label: l.label, desc: l.desc, icon: l.icon, to: l.to }));

// =====================================================================================
// التقارير والحسابات
// =====================================================================================
export function ReportsSection() {
  const can = usePerm();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const today = todayISO();
  const month = today.slice(0, 7) + '-01';
  const data = useLiveQuery(async () => {
    const stats: SectionStat[] = [];
    const sumBal = async (kind: string) => (await db.parties.where('kind').equals(kind).toArray()).reduce((s, p) => s + (p.balance ?? 0), 0);
    if (can('sales.view')) {
      const ps = prevSpans(today);
      const span = (await db.documents.where('date').between(ps.pmFrom, today, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return'));
      const total = (xs: any[]) => xs.reduce((s, d) => s + (d.doc_type === 'sale_invoice' ? d.total : -d.total), 0);
      const cur = total(span.filter((d) => d.date >= month));
      const prev = total(span.filter((d) => d.date >= ps.pmFrom && d.date <= ps.pmTo));
      stats.push({ key: 'sales', label: 'مبيعات الشهر', value: formatMoney(cur), sub: 'بعد المرتجعات', change: { pct: pctChange(cur, prev), vs: 'عن الشهر اللي فات' }, icon: <ShoppingCart />, color: 'green', valueTone: 'green', to: '/reports/analysis' });
    }
    const week = new Date();
    week.setDate(week.getDate() + 7);
    if (can('treasury.view')) {
      const cash = (await db.cashboxes.toArray()).filter((c) => c.active !== false).reduce((s, c) => s + (c.balance ?? 0), 0);
      stats.push({ key: 'cash', label: 'النقدية بالخزائن والبنوك', value: formatMoney(cash), icon: <Wallet />, color: 'blue', to: '/cashboxes' });
    }
    if (can('parties.view')) {
      stats.push({ key: 'ar', label: 'مستحق من العملاء', value: formatMoney(await sumBal('customer')), icon: <Users />, color: 'orange', to: '/parties/customer' });
      stats.push({ key: 'ap', label: 'مستحق للموردين', value: formatMoney(await sumBal('supplier')), icon: <Truck />, color: 'purple', to: '/parties/supplier' });
    }
    if (can('treasury.view')) {
      const due = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= todayISO(week)).length;
      stats.push({ key: 'due', label: 'شيكات وأقساط خلال أسبوع', value: due, icon: <CalendarClock />, color: 'pink', valueTone: due ? 'orange' : undefined, to: '/instruments' });
    }
    return { stats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, permsKey]);
  const top = toLinks(useHubLinks('reports', ['أهم التقارير']));
  const stock = useHubLinks('inventory', ['تقارير المخزون']);
  const treasury = useHubLinks('treasury', ['ابدأ', 'المتابعة']).filter((l) => l.to.startsWith('/reports/'));
  const more = toLinks([...stock, ...treasury]);
  const accounts = toFollow(useHubLinks('reports', ['الحسابات']));
  return (
    <div className="page sx-page">
      <SectionHeader icon={<BarChart3 />} color="pink" title="التقارير والحسابات" sub="الأرباح والميزانية وتحليل المبيعات وتقارير المخزون والخزينة" />
      <SectionStats items={data?.stats ?? []} />
      <QuickActions section="reports" defaults={['journal_voucher', 'expense', 'receipt', 'payment', 'income', 'cash_transfer']} />
      <ResponsiveSectionLayout
        side={accounts.length > 0 && <FollowUpPanel title="الحسابات" icon={<BookOpen />} items={accounts} />}
        main={(top.length > 0 || more.length > 0) && <>
          {top.length > 0 && <SectionCard icon={<BarChart3 />} title="أهم التقارير"><LinkGrid items={top} /></SectionCard>}
          {more.length > 0 && <SectionCard icon={<Package />} title="تقارير المخزون والخزينة"><LinkGrid items={more} /></SectionCard>}
        </>}
      />
    </div>
  );
}

// =====================================================================================
// الإعدادات
// =====================================================================================
export function SettingsSection() {
  const { session } = useSession();
  const sync = useSyncState();
  const counts = useSyncCounts();
  const reachable = sync.online && sync.serverReachable;
  const problems = counts.rejected + counts.conflicts;
  const stats: SectionStat[] = [
    { key: 'conn', label: 'الاتصال بالخادم', value: reachable ? 'متصل' : 'بدون اتصال', sub: reachable ? 'البيانات بتتزامن تلقائيًا' : 'الشغل بيتحفظ على الجهاز', icon: reachable ? <CheckCircle2 /> : <CloudOff />, color: reachable ? 'green' : 'slate', valueTone: reachable ? 'green' : undefined, to: '/sync' },
    { key: 'pending', label: 'بانتظار الإرسال', value: counts.pending, sub: counts.pending ? 'عمليات لسه ما اتبعتتش' : 'كله اتبعت', icon: <RefreshCw />, color: 'blue', valueTone: counts.pending ? 'orange' : undefined, to: '/sync' },
    { key: 'problems', label: 'مشاكل المزامنة', value: problems, sub: problems ? 'محتاجة مراجعة' : 'مفيش', icon: <AlertTriangle />, color: 'red', valueTone: problems ? 'red' : undefined, to: '/sync' },
    { key: 'me', label: 'المستخدم الحالي', value: session.user.full_name || session.user.username || '—', sub: session.user.username, icon: <UserCircle />, color: 'purple' },
  ];
  const system = useHubLinks('system', ['النظام']);
  return (
    <div className="page sx-page">
      <SectionHeader icon={<Settings />} color="slate" title="الإعدادات" sub="بيانات الشركة والمستخدمين والمزامنة والنسخ الاحتياطي" />
      <SectionStats items={stats} />
      <ResponsiveSectionLayout main={<SectionCard icon={<Settings />} title="إعدادات النظام"><LinkGrid items={toLinks(system)} /></SectionCard>} />
    </div>
  );
}

