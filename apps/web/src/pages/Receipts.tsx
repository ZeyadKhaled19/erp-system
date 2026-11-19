import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, CalendarDays, FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DateInput, DocStatusBadge, Empty, exportExcel } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, userCashboxes } from '../lib/hooks';
import './expenses.css';

export function ReceiptsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const can = usePerm();
  const { session } = useSession();
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [status, setStatus] = useState('all');
  const data = useLiveQuery(async () => {
    if (!can('treasury.view')) return null;
    const cashboxes = await userCashboxes(session.user);
    const allowed = new Set(cashboxes.map((c) => c.id));
    const docs = (await db.documents.where('doc_type').equals('receipt').toArray())
      .filter((d) => allowed.has(d.cashbox_id ?? ''));
    const partyIds = [...new Set(docs.flatMap((d) => d.party_id ? [d.party_id] : []))];
    const accountIds = [...new Set(docs.flatMap((d) => d.account_id ? [d.account_id] : []))];
    const [parties, accounts] = await Promise.all([db.parties.bulkGet(partyIds), db.accounts.bulkGet(accountIds)]);
    return { docs, cashboxes, names: new Map([...parties, ...accounts].filter((p) => !!p).map((p) => [p!.id, p!.name])) };
  }, [session.user.id, session.user.permissions.join(','), session.user.cashbox_ids?.join(',')]);
  const cashboxes = data?.cashboxes ?? [];
  const names = data?.names ?? new Map<string, string>();
  const cashboxNames = new Map(cashboxes.map((c) => [c.id, c.name]));
  const list = (data?.docs ?? []).filter((d) => d.date >= from && d.date <= to && (!cashboxId || d.cashbox_id === cashboxId) && (status === 'all' || d.status === status))
    .filter((d) => !query.trim() || [d.number, d.local_number, d.notes, names.get(d.party_id ?? d.account_id ?? ''), cashboxNames.get(d.cashbox_id ?? '')].some((s) => s?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  const posted = list.filter((d) => d.status === 'posted');
  const total = posted.reduce((s, d) => s + d.total, 0);
  const monthTotal = (data?.docs ?? []).filter((d) => d.status === 'posted' && d.date >= monthStart && d.date <= today).reduce((s, d) => s + d.total, 0);
  const groups = cashboxes.map((c) => {
    const rows = posted.filter((d) => d.cashbox_id === c.id);
    return { id: c.id, name: String(c.name ?? ''), count: rows.length, total: rows.reduce((s, d) => s + d.total, 0) };
  }).filter((c) => !cashboxId || c.id === cashboxId).sort((a, b) => b.total - a.total);
  const exportRows = () => exportExcel('قبض', ['رقم العملية', 'التاريخ', 'الطرف / الحساب', 'الخزينة', 'المبلغ', 'الحالة', 'ملاحظات'], list.map((d) => [d.number ?? d.local_number ?? '', d.date, names.get(d.party_id ?? d.account_id ?? '') ?? '', cashboxNames.get(d.cashbox_id ?? '') ?? '', formatMoney(d.total), d.status, d.notes ?? '']));

  return <div className="page expenses-page">
    <PageHeader title="قبض" sub="سجّل المقبوضات وتابع التحصيل والخزائن وتفاصيل كل عملية."
      actions={<><button className="btn" onClick={exportRows}>تصدير السجل</button>{can('treasury.create') && <button className="btn primary" onClick={() => nav('/docs/new/receipt', { state: { backgroundLocation: location } })}><Plus /> قبض جديد</button>}</>} />
    <section className="expense-kpis" aria-label="ملخص القبض">
      <article className="card expense-kpi"><span className="expense-kpi-icon green"><ArrowDownLeft /></span><div><span className="muted">إجمالي القبض خلال الفترة</span><strong className="num">{formatMoney(total)}</strong><small className="muted">العمليات المرحلة المطابقة للفلاتر</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon blue"><CalendarDays /></span><div><span className="muted">قبض الشهر الحالي</span><strong className="num">{formatMoney(monthTotal)}</strong><small className="muted">كل الخزائن المسموح بها</small></div></article>
      <article className="card expense-kpi"><span className="expense-kpi-icon orange"><FileText /></span><div><span className="muted">عدد عمليات القبض المرحلة</span><strong className="num">{posted.length}</strong><small className="muted">إجمالي السجل المعروض: {list.length}</small></div></article>
    </section>
    <div className="expense-overview">
      <section className="card pad expense-categories"><div className="expense-section-title"><div><h2>توزيع القبض حسب الخزينة</h2><p className="muted">سندات القبض المرحلة فقط؛ لا يشمل المدفوع داخل فواتير البيع</p></div><ArrowDownLeft /></div>
        {posted.length ? <div className="expense-category-list">{groups.filter((c) => c.count).map((c) => <div key={c.id}><div className="expense-category-label"><span>{c.name}</span><strong className="num">{formatMoney(c.total)} · {total ? (c.total / total * 100).toFixed(1) : 0}%</strong></div><div className="expense-bar"><span style={{ width: `${total ? c.total / total * 100 : 0}%` }} /></div></div>)}</div> : <div className="expense-chart-empty">لا توجد عمليات قبض مرحلة في الفترة المحددة.</div>}
      </section>
      <section className="card pad expense-period"><div className="expense-section-title"><div><h2>الفترة</h2><p className="muted">تُطبق على التقرير والسجل</p></div><CalendarDays /></div>
        <label className="expense-filter-field">من تاريخ<DateInput value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="expense-filter-field">إلى تاريخ<DateInput value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn sm" onClick={() => { setFrom(monthStart); setTo(today); }}>الشهر الحالي</button>
      </section>
    </div>
    <section className="card expense-history expense-category-report"><div className="expense-history-head"><div><h2>تقرير القبض بكل الخزائن</h2><p className="muted">من {from} إلى {to} · العمليات المرحلة حسب الفلاتر</p></div><button className="btn sm" onClick={() => exportExcel('تقرير القبض', ['الخزينة', 'عدد العمليات', 'المبلغ'], groups.map((c) => [c.name, c.count, formatMoney(c.total)]))}>تصدير التقرير</button></div>
      <div className="table-wrap"><table className="table responsive"><thead><tr><th>الخزينة / البنك</th><th>عدد العمليات</th><th className="n">المبلغ</th></tr></thead><tbody>{groups.map((c) => <tr key={c.id}><td data-label="الخزينة / البنك">{c.name}</td><td data-label="عدد العمليات" className="num">{c.count}</td><td data-label="المبلغ" className="n num bold">{formatMoney(c.total)}</td></tr>)}</tbody><tfoot><tr><th>الإجمالي</th><td className="num">{posted.length}</td><td className="n num bold">{formatMoney(total)}</td></tr></tfoot></table></div>
    </section>
    <section className="card expense-history"><div className="expense-history-head"><div><h2>سجل القبض</h2><p className="muted">{list.length} عملية · اختر العملية لعرض بياناتها وتخصيصها للفواتير</p></div></div>
      <div className="expense-filters"><label className="expense-search"><Search /><input className="input" placeholder="ابحث بالرقم أو الطرف أو الملاحظات" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <select className="select" aria-label="الخزينة" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}><option value="">كل الخزائن</option>{cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="select" aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">بانتظار المراجعة</option><option value="cancelled">ملغي</option></select>
      </div>
      {!list.length ? <div className="expense-empty"><Empty icon={<ArrowDownLeft />} title={data === undefined ? 'جارٍ تحميل القبض…' : 'لا توجد عمليات قبض مطابقة'} /></div> : <div className="table-wrap"><table className="table responsive"><thead><tr><th>رقم العملية</th><th>التاريخ</th><th>الطرف / الحساب</th><th>الخزينة</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead><tbody>{list.map((d) => <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}><td data-label="رقم العملية" className="num bold">{d.number ?? d.local_number ?? '—'}</td><td data-label="التاريخ" className="num">{d.date}</td><td data-label="الطرف / الحساب">{names.get(d.party_id ?? d.account_id ?? '') ?? '—'}{d.notes && <small className="expense-note">{d.notes}</small>}</td><td data-label="الخزينة">{cashboxNames.get(d.cashbox_id ?? '') ?? '—'}</td><td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td><td data-label="المبلغ" className="n num bold">{formatMoney(d.total)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
