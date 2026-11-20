import { todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight, Building2, FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DateInput, DocStatusBadge, Empty, exportExcel } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession } from '../lib/hooks';
import './expenses.css';

export function StockTransfersPage() {
  const nav = useNavigate();
  const location = useLocation();
  const can = usePerm();
  const { session } = useSession();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const data = useLiveQuery(async () => {
    if (!can('inventory.view')) return null;
    const warehouses = (await db.warehouses.toArray()).filter((w) => !session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id));
    const sources = warehouses;
    const allowed = new Set(sources.map((w) => w.id));
    // Match document visibility in sync: both warehouses must be in the user's scope.
    const docs = (await db.documents.where('doc_type').equals('stock_transfer').toArray()).filter((d) => allowed.has(d.warehouse_id ?? '') && allowed.has(d.to_warehouse_id ?? ''));
    const counts = new Map(await Promise.all(docs.map(async (d) => [d.id, await db.document_lines.where('document_id').equals(d.id).count()] as const)));
    return { warehouses, sources, docs, counts };
  }, [session.user.id, session.user.permissions.join(','), session.user.warehouse_ids?.join(',')]);
  const warehouses = data?.warehouses ?? [];
  const sources = data?.sources ?? [];
  const names = new Map(warehouses.map((w) => [w.id, w.name]));
  const list = (data?.docs ?? []).filter((d) => d.date >= from && d.date <= to && (!source || d.warehouse_id === source) && (!destination || d.to_warehouse_id === destination) && (status === 'all' || d.status === status))
    .filter((d) => !query.trim() || [d.number, d.local_number, d.notes, names.get(d.warehouse_id ?? ''), names.get(d.to_warehouse_id ?? '')].some((v) => v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  const posted = list.filter((d) => d.status === 'posted');
  const waiting = list.filter((d) => d.status === 'draft' || d.status === 'pending_review');
  const active = warehouses.filter((w) => w.active !== false);
  const canCreate = sources.some((s) => s.active !== false && active.some((w) => w.id !== s.id));
  const groups = warehouses.map((w) => ({ id: w.id, name: w.name, sent: posted.filter((d) => d.warehouse_id === w.id).length, received: posted.filter((d) => d.to_warehouse_id === w.id).length })).filter((g) => g.sent || g.received);
  const pageCount = Math.max(1, Math.ceil(list.length / 30));
  const safePage = Math.min(page, pageCount - 1);
  return <div className="page expenses-page">
    <PageHeader title="تحويل البضاعة بين المخازن" sub="انقل الأصناف وراجع التحويلات من مخازنك إلى المخازن الأخرى."
      actions={<><button className="btn" disabled={!list.length} onClick={() => exportExcel('تحويلات المخازن', ['الرقم', 'التاريخ', 'من مخزن', 'إلى مخزن', 'عدد السطور', 'الحالة', 'ملاحظات'], list.map((d) => [d.number ?? d.local_number, d.date, names.get(d.warehouse_id ?? ''), names.get(d.to_warehouse_id ?? ''), data?.counts.get(d.id) ?? 0, d.status, d.notes ?? '']))}>تصدير السجل</button>{can('inventory.create') && <button className="btn primary" disabled={!canCreate} onClick={() => nav('/docs/new/stock_transfer', { state: { backgroundLocation: location } })}><Plus /> تحويل جديد</button>}</>} />
    {data && !canCreate && <Banner kind="info">التحويل يحتاج مخزن مصدر مفعّلًا ضمن صلاحياتك ومخزن وجهة مختلفًا.</Banner>}
    <section className="expense-kpis" aria-label="ملخص تحويلات المخازن">
      <article className="card expense-kpi"><span className="expense-kpi-icon orange"><ArrowLeftRight /></span><div><span className="muted">التحويلات المرحلة</span><strong className="num">{posted.length}</strong><small className="muted">خلال الفترة والفلاتر المختارة</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon blue"><FileText /></span><div><span className="muted">بانتظار الإكمال أو المراجعة</span><strong className="num">{waiting.length}</strong><small className="muted">مسودات ومستندات تحتاج مراجعة</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon green"><Building2 /></span><div><span className="muted">مخازن استقبلت تحويلات</span><strong className="num">{new Set(posted.map((d) => d.to_warehouse_id)).size}</strong><small className="muted">من مخازن المصدر المسموحة لك</small></div></article>
    </section>
    {!!groups.length && <section className="card expense-history"><div className="expense-history-head"><div><h2>حركة التحويلات حسب المخزن</h2><p className="muted">عدد المستندات المرحلة المطابقة للفلاتر؛ لا تُجمع كميات الأصناف ذات الوحدات المختلفة.</p></div></div><div className="table-wrap"><table className="table responsive"><thead><tr><th>المخزن</th><th>تحويلات صادرة</th><th>تحويلات واردة</th></tr></thead><tbody>{groups.map((g) => <tr key={g.id}><td data-label="المخزن">{g.name}</td><td data-label="تحويلات صادرة" className="num">{g.sent}</td><td data-label="تحويلات واردة" className="num">{g.received}</td></tr>)}</tbody></table></div></section>}
    <section className="card expense-history"><div className="expense-history-head"><div><h2>سجل التحويلات</h2><p className="muted">بيانات الجهاز المتاحة من مخازن المصدر المسموحة لك · افتح المستند لمراجعة الأصناف والكميات.</p></div></div>
      <div className="expense-filters"><label className="expense-search"><Search /><input className="input" placeholder="رقم التحويل أو المخزن أو الملاحظات" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
        <select className="select" aria-label="من مخزن" value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}><option value="">من كل المخازن المسموحة</option>{sources.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select className="select" aria-label="إلى مخزن" value={destination} onChange={(e) => { setDestination(e.target.value); setPage(0); }}><option value="">إلى كل المخازن</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select className="select" aria-label="حالة التحويل" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">بانتظار المراجعة</option><option value="cancelled">ملغي</option></select>
        <label className="transfer-date-filter">من<DateInput value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label><label className="transfer-date-filter">إلى<DateInput value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
      </div>
      {!list.length ? <div className="expense-empty"><Empty icon={<ArrowLeftRight />} title={data === undefined ? 'جارٍ تحميل التحويلات…' : 'لا توجد تحويلات مطابقة'} /></div> : <div className="table-wrap"><table className="table responsive"><thead><tr><th>رقم التحويل</th><th>التاريخ</th><th>من مخزن</th><th>إلى مخزن</th><th>عدد السطور</th><th>ملاحظات</th><th>الحالة</th></tr></thead><tbody>{list.slice(safePage * 30, safePage * 30 + 30).map((d) => <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}><td data-label="رقم التحويل" className="num bold">{d.number ?? d.local_number ?? '—'}</td><td data-label="التاريخ" className="num">{d.date}</td><td data-label="من مخزن">{names.get(d.warehouse_id ?? '') ?? '—'}</td><td data-label="إلى مخزن">{names.get(d.to_warehouse_id ?? '') ?? '—'}</td><td data-label="عدد السطور" className="num">{data?.counts.get(d.id) ?? 0}</td><td data-label="ملاحظات">{d.notes || '—'}</td><td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td></tr>)}</tbody></table></div>}
      <div className="transfer-pagination"><span className="muted">صفحة {safePage + 1} من {pageCount}</span><button className="btn sm" disabled={!safePage} onClick={() => setPage(safePage - 1)}>السابق</button><button className="btn sm" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>التالي</button></div>
    </section>
  </div>;
}
