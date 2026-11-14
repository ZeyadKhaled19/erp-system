import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, ClipboardCheck, FileClock, FileText, ShoppingCart, Tag, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RowActions } from '../components/ListParts';
import { HUBS } from '../components/nav';
import { FollowUpPanel, QuickActions, ResponsiveSectionLayout, SectionCard, SectionHeader, SectionStats, type FollowUpItem, type SectionStat } from '../components/Section';
import { DocStatusBadge } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession } from '../lib/hooks';

/** العمليات السريعة الافتراضية للمبيعات (كل مستخدم يقدر يغيّرها من «تخصيص») */
const SALES_ACTIONS = ['sale_invoice', 'pos', 'sale_return', 'quotation', 'receipt', 'customer_new'];

/** صفحة قسم المبيعات — على الصورة المعتمدة */
export function SalesSection() {
  const can = usePerm();
  const nav = useNavigate();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const today = todayISO();
  const month = today.slice(0, 7) + '-01';

  const data = useLiveQuery(async () => {
    const stats: SectionStat[] = [];
    let recent: any[] = [];
    let openCredit = 0;
    let overdue = 0;
    let pendingDelivery = 0;
    const parties = can('parties.view') || can('sales.view') ? await db.parties.toArray() : [];
    const partyName = new Map(parties.map((p) => [p.id, p.name]));
    if (can('sales.view')) {
      const sales = await db.documents.where('doc_type').equals('sale_invoice').toArray();
      const monthDocs = (await db.documents.where('date').between(month, today, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return'));
      const sign = (d: any) => (d.doc_type === 'sale_invoice' ? d.total : -d.total);
      const todayDocs = monthDocs.filter((d) => d.date === today);
      const open = sales.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid);
      openCredit = open.length;
      overdue = open.filter((d) => d.due_date && d.due_date < today).length;
      pendingDelivery = sales.filter((d) => d.status === 'posted' && d.deliver_later).length;
      stats.push({ key: 'today', label: 'مبيعات اليوم', value: formatMoney(todayDocs.reduce((s, d) => s + sign(d), 0)), sub: `${todayDocs.filter((d) => d.doc_type === 'sale_invoice').length} فاتورة`, icon: <ShoppingCart />, color: 'blue', to: '/invoices' });
      stats.push({ key: 'month', label: 'مبيعات الشهر', value: formatMoney(monthDocs.reduce((s, d) => s + sign(d), 0)), sub: 'بعد المرتجعات', icon: <BarChart3 />, color: 'green', valueTone: 'green', to: can('reports.view') ? '/reports/analysis' : undefined });
      recent = sales
        .sort((a, b) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date)))
        .slice(0, 5)
        .map((d) => ({ ...d, party: d.party_id ? partyName.get(d.party_id) ?? '—' : 'عميل نقدي' }));
    }
    if (can('parties.view')) {
      const owed = parties.filter((p) => p.kind === 'customer').reduce((s, p) => s + (p.balance ?? 0), 0);
      stats.push({ key: 'receivable', label: 'مستحقات العملاء', value: formatMoney(owed), icon: <Users />, color: 'orange', to: '/parties/customer' });
    }
    if (can('sales.view')) {
      stats.push({ key: 'credit', label: 'فواتير آجلة', value: openCredit, sub: overdue ? `منها ${overdue} متأخرة السداد` : 'غير مسددة بالكامل', icon: <FileClock />, color: 'purple', valueTone: overdue ? 'red' : undefined, to: '/receivables' });
    }
    if (can('sales.quotation') || can('sales.view')) {
      const q = (await db.documents.where('doc_type').equals('quotation').toArray()).filter((d) => !d.converted_to_id && d.status !== 'cancelled').length;
      stats.push({ key: 'quotes', label: 'عروض أسعار مفتوحة', value: q, icon: <Tag />, color: 'pink', to: '/docs/list/sales' });
    }
    return { stats, recent, openCredit, overdue, pendingDelivery };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, permsKey]);

  // سطور المتابعة من نفس روابط القسم (كل سطر لمن يملك صلاحيته)
  const links = HUBS.find((h) => h.key === 'sales')?.groups.find((g) => g.title === 'المتابعة')?.links ?? [];
  const follow: FollowUpItem[] = links
    .filter((l) => !l.perm || can(l.perm))
    .map((l) => ({
      key: l.to, label: l.label, icon: l.icon, to: l.to,
      ...(l.to === '/receivables' ? { count: data?.openCredit ?? 0, tone: 'red' as const, title: data?.overdue ? `${data.overdue} منها عدّى ميعاد سدادها` : undefined } : {}),
      ...(l.to === '/deliveries' ? { count: data?.pendingDelivery ?? 0, tone: 'blue' as const, title: 'فواتير بانتظار التسليم' } : {}),
    }));

  return (
    <div className="page sx-page">
      <SectionHeader icon={<ShoppingCart />} color="blue" title="المبيعات" sub="إدارة فواتير البيع والمرتجعات وعروض الأسعار" />
      <SectionStats items={data?.stats ?? []} />
      <QuickActions section="sales" defaults={SALES_ACTIONS} />
      <ResponsiveSectionLayout
        side={<FollowUpPanel icon={<ClipboardCheck />} items={follow} />}
        main={can('sales.view') && (
          <SectionCard icon={<FileText />} title="آخر فواتير البيع" moreTo="/invoices" className="sx-recent">
            {!data ? null : data.recent.length === 0 ? (
              <div className="sx-table"><div className="sx-empty">لسه مفيش فواتير بيع.</div></div>
            ) : (
              <div className="sx-table">
                <table className="table responsive">
                  <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th className="n">الإجمالي</th><th>الحالة</th><th /></tr></thead>
                  <tbody>
                    {data.recent.map((d) => {
                      const editable = (d.status === 'draft' || d.status === 'pending_review' || d._sync === 'rejected') && can('sales.create');
                      return (
                        <tr key={d.id} onClick={() => nav(`/docs/view/${d.id}`)}>
                          <td data-label="رقم الفاتورة" className="num bold">{d.number ?? d.local_number ?? '—'}</td>
                          <td data-label="التاريخ" className="num">{d.date}</td>
                          <td data-label="العميل">{d.party}</td>
                          <td data-label="الإجمالي" className="n bold">{formatMoney(d.total ?? 0)}</td>
                          <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                          <td data-label="" className="lp-act-cell">
                            <RowActions openLabel="عرض الفاتورة" onOpen={() => nav(`/docs/view/${d.id}`)} onEdit={editable ? () => nav(`/docs/edit/${d.id}`) : undefined} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      />
    </div>
  );
}
