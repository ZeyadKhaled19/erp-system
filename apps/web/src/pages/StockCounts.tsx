import { todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DateInput, DocStatusBadge, Empty, exportExcel } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession } from '../lib/hooks';
import './expenses.css';

export function StockCountsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const can = usePerm();
  const { session } = useSession();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const data = useLiveQuery(async () => {
    if (!can('inventory.view')) return null;
    // Include inactive warehouses in historical reports; the editor only offers active ones.
    const warehouses = (await db.warehouses.toArray()).filter((w) => !session.user.warehouse_ids || session.user.warehouse_ids.includes(w.id));
    const allowed = new Set(warehouses.map((w) => w.id));
    const docs = (await db.documents.where('doc_type').equals('stock_adjustment').toArray()).filter((d) => allowed.has(d.warehouse_id ?? ''));
    const counts = new Map(await Promise.all(docs.map(async (d) => [d.id, await db.document_lines.where('document_id').equals(d.id).count()] as const)));
    return { warehouses, docs, counts };
  }, [session.user.id, session.user.permissions.join(','), session.user.warehouse_ids?.join(',')]);
  const warehouses = data?.warehouses ?? [];
  const names = new Map(warehouses.map((w) => [w.id, w.name]));
  const list = (data?.docs ?? []).filter((d) => d.date >= from && d.date <= to && (!warehouse || d.warehouse_id === warehouse) && (status === 'all' || d.status === status))
    .filter((d) => !query.trim() || [d.number, d.local_number, d.notes, names.get(d.warehouse_id ?? '')].some((v) => v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  const posted = list.filter((d) => d.status === 'posted');
  const drafts = list.filter((d) => d.status === 'draft' || d.status === 'pending_review');
  const pageCount = Math.max(1, Math.ceil(list.length / 30));
  const safePage = Math.min(page, pageCount - 1);
  return <div className="page expenses-page">
    <PageHeader title="الجرد وتسوية المخزون" sub="سجّل العدد الفعلي وراجع عمليات الجرد لكل مخزن."
      actions={<><button className="btn" disabled={!list.length} onClick={() => exportExcel('سجل الجرد', ['الرقم', 'التاريخ', 'المخزن', 'عدد السطور', 'الحالة', 'سبب الجرد'], list.map((d) => [d.number ?? d.local_number, d.date, names.get(d.warehouse_id ?? ''), data?.counts.get(d.id) ?? 0, d.status, d.notes ?? '']))}>تصدير السجل</button>{can('inventory.create') && <button className="btn primary" disabled={!warehouses.some((w) => w.active !== false)} onClick={() => nav('/docs/new/stock_adjustment', { state: { backgroundLocation: location } })}><Plus /> جرد جديد</button>}</>} />
    <section className="expense-kpis" aria-label="ملخص الجرد">
      <article className="card expense-kpi"><span className="expense-kpi-icon orange"><ClipboardCheck /></span><div><span className="muted">عمليات جرد مرحلة</span><strong className="num">{posted.length}</strong><small className="muted">خلال الفترة والفلاتر المختارة</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon blue"><FileText /></span><div><span className="muted">بانتظار الإكمال أو المراجعة</span><strong className="num">{drafts.length}</strong><small className="muted">مسودات ومستندات تحتاج مراجعة</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon green"><ClipboardCheck /></span><div><span className="muted">المخازن التي تم جردها</span><strong className="num">{new Set(posted.map((d) => d.warehouse_id)).size}</strong><small className="muted">العمليات المرحلة فقط</small></div></article>
    </section>
    <section className="card expense-history"><div className="expense-history-head"><div><h2>سجل الجرد</h2><p className="muted">بيانات الجهاز المتاحة · افتح المستند لمراجعة الأصناف وتفاصيل التسوية.</p></div></div>
      <div className="expense-filters"><label className="expense-search"><Search /><input className="input" placeholder="رقم الجرد أو المخزن أو السبب" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
        <select className="select" aria-label="المخزن" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(0); }}><option value="">كل المخازن المسموحة</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select className="select" aria-label="حالة الجرد" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">بانتظار المراجعة</option><option value="cancelled">ملغي</option></select>
        <label className="transfer-date-filter">من<DateInput value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label><label className="transfer-date-filter">إلى<DateInput value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
      </div>
      {!list.length ? <div className="expense-empty"><Empty icon={<ClipboardCheck />} title={data === undefined ? 'جارٍ تحميل الجرد…' : 'لا توجد عمليات جرد مطابقة'} /></div> : <div className="table-wrap"><table className="table responsive"><thead><tr><th>رقم الجرد</th><th>التاريخ</th><th>المخزن</th><th>عدد السطور</th><th>السبب</th><th>الحالة</th></tr></thead><tbody>{list.slice(safePage * 30, safePage * 30 + 30).map((d) => <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}><td data-label="رقم الجرد" className="num bold">{d.number ?? d.local_number ?? '—'}</td><td data-label="التاريخ" className="num">{d.date}</td><td data-label="المخزن">{names.get(d.warehouse_id ?? '')}</td><td data-label="عدد السطور" className="num">{data?.counts.get(d.id) ?? 0}</td><td data-label="السبب">{d.notes || '—'}</td><td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td></tr>)}</tbody></table></div>}
      <div className="transfer-pagination"><span className="muted">صفحة {safePage + 1} من {pageCount}</span><button className="btn sm" disabled={!safePage} onClick={() => setPage(safePage - 1)}>السابق</button><button className="btn sm" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>التالي</button></div>
    </section>
  </div>;
}
