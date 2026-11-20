import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight, CalendarDays, FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DateInput, DocStatusBadge, Empty, exportExcel } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, userCashboxes } from '../lib/hooks';
import './expenses.css';

export function CashTransfersPage() {
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
    if (!can('treasury.view')) return null;
    const cashboxes = await userCashboxes(session.user);
    const allowed = new Set(cashboxes.map((c) => c.id));
    const docs = (await db.documents.where('doc_type').equals('cash_transfer').toArray())
      .filter((d) => allowed.has(d.cashbox_id ?? '') && allowed.has(d.to_cashbox_id ?? ''));
    return { cashboxes, docs };
  }, [session.user.id, session.user.permissions.join(','), session.user.cashbox_ids?.join(',')]);
  const boxes = data?.cashboxes ?? [];
  const names = new Map(boxes.map((c) => [c.id, String(c.name)]));
  const list = (data?.docs ?? []).filter((d) => d.date >= from && d.date <= to && (!source || d.cashbox_id === source) && (!destination || d.to_cashbox_id === destination) && (status === 'all' || d.status === status))
    .filter((d) => !query.trim() || [d.number, d.local_number, d.notes, names.get(d.cashbox_id ?? ''), names.get(d.to_cashbox_id ?? '')].some((v) => v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  const posted = list.filter((d) => d.status === 'posted');
  const total = posted.reduce((sum, d) => sum + d.total, 0);
  const groups = boxes.map((box) => ({ id: box.id, name: String(box.name), sent: posted.filter((d) => d.cashbox_id === box.id).reduce((sum, d) => sum + d.total, 0), received: posted.filter((d) => d.to_cashbox_id === box.id).reduce((sum, d) => sum + d.total, 0) }));
  const pageCount = Math.max(1, Math.ceil(list.length / 30));
  const safePage = Math.min(page, pageCount - 1);

  return <div className="page expenses-page">
    <PageHeader title="التحويل بين الخزائن" sub="انقل الأموال بين الخزائن والبنوك وراجع حركة كل تحويل."
      actions={<><button className="btn" disabled={!list.length} onClick={() => exportExcel('تحويلات الخزائن', ['الرقم', 'التاريخ', 'من خزينة', 'إلى خزينة', 'المبلغ', 'الحالة', 'ملاحظات'], list.map((d) => [d.number ?? d.local_number, d.date, names.get(d.cashbox_id ?? ''), names.get(d.to_cashbox_id ?? ''), formatMoney(d.total), d.status, d.notes ?? '']))}>تصدير السجل</button>{can('treasury.create') && <button className="btn primary" disabled={boxes.length < 2} onClick={() => nav('/docs/new/cash_transfer', { state: { backgroundLocation: location } })}><Plus /> تحويل جديد</button>}</>} />
    {data && boxes.length < 2 && <Banner kind="info">التحويل يحتاج خزنتين مفعّلتين على الأقل ضمن صلاحياتك.</Banner>}
    <section className="expense-kpis" aria-label="ملخص التحويلات">
      <article className="card expense-kpi"><span className="expense-kpi-icon orange"><ArrowLeftRight /></span><div><span className="muted">إجمالي التحويلات</span><strong className="num">{formatMoney(total)}</strong><small className="muted">كل تحويل يُحسب مرة واحدة</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon blue"><FileText /></span><div><span className="muted">التحويلات المرحلة</span><strong className="num">{posted.length}</strong><small className="muted">خلال الفترة وحسب الفلاتر</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon green"><CalendarDays /></span><div><span className="muted">كل الحالات المعروضة</span><strong className="num">{list.length}</strong><small className="muted">المسودات والملغى خارج الإجمالي</small></div></article>
    </section>
    <section className="card expense-history expense-category-report"><div className="expense-history-head"><div><h2>توزيع التحويلات على الخزائن</h2><p className="muted">تحويلات داخلية؛ المبلغ الخارج من خزينة يساوي الداخل للأخرى.</p></div><button className="btn sm" onClick={() => exportExcel('توزيع تحويلات الخزائن', ['الخزينة', 'محول منها', 'محول إليها', 'صافي التحويلات'], groups.map((g) => [g.name, formatMoney(g.sent), formatMoney(g.received), formatMoney(g.received - g.sent)]))}>تصدير التقرير</button></div>
      <div className="table-wrap"><table className="table responsive"><thead><tr><th>الخزينة</th><th className="n">محوّل منها</th><th className="n">محوّل إليها</th><th className="n">صافي التحويلات</th></tr></thead><tbody>{groups.map((g) => <tr key={g.id}><td data-label="الخزينة">{g.name}</td><td data-label="محوّل منها" className="n num">{formatMoney(g.sent)}</td><td data-label="محوّل إليها" className="n num">{formatMoney(g.received)}</td><td data-label="صافي التحويلات" className="n num bold">{formatMoney(g.received - g.sent)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card expense-history"><div className="expense-history-head"><div><h2>سجل التحويلات</h2><p className="muted">المتاح من بيانات الجهاز · اضغط على التحويل لعرض تفاصيله</p></div></div>
      <div className="expense-filters"><label className="expense-search"><Search /><input className="input" value={query} placeholder="رقم التحويل أو الخزينة أو الملاحظات" onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
        <select className="select" aria-label="من خزينة" value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}><option value="">من كل الخزائن</option>{boxes.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select>
        <select className="select" aria-label="إلى خزينة" value={destination} onChange={(e) => { setDestination(e.target.value); setPage(0); }}><option value="">إلى كل الخزائن</option>{boxes.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select>
        <select className="select" aria-label="حالة التحويل" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">بانتظار المراجعة</option><option value="cancelled">ملغي</option></select>
        <label className="transfer-date-filter">من<DateInput value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label><label className="transfer-date-filter">إلى<DateInput value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
      </div>
      {!list.length ? <div className="expense-empty"><Empty icon={<ArrowLeftRight />} title={data === undefined ? 'جارٍ تحميل التحويلات…' : 'لا توجد تحويلات مطابقة'} /></div> : <div className="table-wrap"><table className="table responsive"><thead><tr><th>رقم التحويل</th><th>التاريخ</th><th>من خزينة</th><th>إلى خزينة</th><th className="n">المبلغ</th><th>الحالة</th></tr></thead><tbody>{list.slice(safePage * 30, safePage * 30 + 30).map((d) => <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}><td data-label="رقم التحويل" className="num bold">{d.number ?? d.local_number ?? '—'}</td><td data-label="التاريخ" className="num">{d.date}</td><td data-label="من خزينة">{names.get(d.cashbox_id ?? '')}</td><td data-label="إلى خزينة">{names.get(d.to_cashbox_id ?? '')}</td><td data-label="المبلغ" className="n num bold">{formatMoney(d.total)}</td><td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td></tr>)}</tbody></table></div>}
      <div className="transfer-pagination"><span className="muted">صفحة {safePage + 1} من {pageCount}</span><button className="btn sm" disabled={!safePage} onClick={() => setPage(safePage - 1)}>السابق</button><button className="btn sm" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>التالي</button></div>
    </section>
  </div>;
}
