import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ChartNoAxesColumn, FileText, Plus, Receipt, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DateInput, DocStatusBadge, Empty, exportExcel } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useSession, userCashboxes } from '../lib/hooks';
import './expenses.css';

export function ExpensesPage() {
  const nav = useNavigate();
  const location = useLocation();
  const can = usePerm();
  const { session } = useSession();
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [accountId, setAccountId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [status, setStatus] = useState('all');

  const docs = useLiveQuery(async () => (await db.documents.where('date').between(from, to, true, true).toArray())
    .filter((d) => d.doc_type === 'expense')
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? ''))), [from, to]) ?? [];
  const monthDocs = useLiveQuery(async () => (await db.documents.where('date').between(monthStart, today, true, true).toArray())
    .filter((d) => d.doc_type === 'expense' && d.status === 'posted'), [monthStart, today]) ?? [];
  const accounts = useLiveQuery(async () => (await db.accounts.orderBy('code').toArray()).filter((a) => a.type === 'expense' && !a.is_group && a.active !== false), []) ?? [];
  const cashboxes = useLiveQuery(() => userCashboxes(session.user), [session.user.id, session.user.cashbox_ids]) ?? [];
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const cashboxMap = useMemo(() => new Map(cashboxes.map((c) => [c.id, c.name])), [cashboxes]);
  const permittedCashboxIds = useMemo(() => new Set(cashboxes.map((c) => c.id)), [cashboxes]);

  const list = docs.filter((d) => {
    if (!permittedCashboxIds.has(d.cashbox_id ?? '')) return false;
    if (accountId && d.account_id !== accountId) return false;
    if (cashboxId && d.cashbox_id !== cashboxId) return false;
    if (status !== 'all' && d.status !== status) return false;
    const q = query.trim().toLocaleLowerCase();
    if (q && ![d.number, d.local_number, d.notes, accountMap.get(d.account_id ?? ''), cashboxMap.get(d.cashbox_id ?? '')]
      .some((v) => v?.toLocaleLowerCase().includes(q))) return false;
    return true;
  });
  const posted = list.filter((d) => d.status === 'posted');
  const postedTotal = posted.reduce((sum, d) => sum + d.total, 0);
  const monthTotal = monthDocs.filter((d) => permittedCashboxIds.has(d.cashbox_id ?? '')).reduce((sum, d) => sum + d.total, 0);
  const reportAccounts = new Map(accounts.map((a) => [a.id, a.name]));
  for (const d of posted) if (!reportAccounts.has(d.account_id ?? '')) reportAccounts.set(d.account_id ?? '', 'بند غير متاح');
  const categoryReport = [...reportAccounts].map(([id, name]) => {
    const rows = posted.filter((d) => (d.account_id ?? '') === id);
    return { id, name, count: rows.length, total: rows.reduce((sum, d) => sum + d.total, 0) };
  }).sort((a, b) => b.total - a.total);
  const categoryTotals = categoryReport.filter((a) => a.total > 0);
  const maxCategory = Math.max(1, ...categoryTotals.map((a) => a.total));
  const openNewExpense = () => nav('/docs/new/expense', { state: { backgroundLocation: location } });

  return (
    <div className="page expenses-page">
      <PageHeader
        title="المصروفات"
        sub="تابع المصروفات المسجلة، راجع توزيعها، وسجّل مصروفًا جديدًا."
        actions={<>
          <button className="btn" onClick={() => exportExcel('المصروفات', ['رقم المستند', 'التاريخ', 'بند المصروف', 'الخزينة', 'الحالة', 'المبلغ', 'ملاحظات'], list.map((d) => [d.number ?? d.local_number, d.date, accountMap.get(d.account_id ?? '') ?? '', cashboxMap.get(d.cashbox_id ?? '') ?? '', d.status, formatMoney(d.total), d.notes ?? '']))}>تصدير</button>
          {can('treasury.create') && <button className="btn primary" onClick={openNewExpense}><Plus /> مصروف جديد</button>}
        </>}
      />

      <section className="expense-kpis" aria-label="ملخص المصروفات">
        <article className="card expense-kpi"><span className="expense-kpi-icon orange"><Receipt /></span><div><span className="muted">إجمالي المصروفات المعروضة</span><strong className="num">{formatMoney(postedTotal)}</strong></div></article>
        <article className="card expense-kpi"><span className="expense-kpi-icon blue"><CalendarDays /></span><div><span className="muted">مصروفات هذا الشهر</span><strong className="num">{formatMoney(monthTotal)}</strong></div></article>
        <article className="card expense-kpi"><span className="expense-kpi-icon green"><FileText /></span><div><span className="muted">عدد المستندات المعروضة</span><strong className="num">{list.length}</strong></div></article>
      </section>

      <div className="expense-overview">
        <section className="card pad expense-categories">
          <div className="expense-section-title"><div><h2>المصروفات حسب البند</h2><p className="muted">إجمالي المستندات المرحلة خلال الفترة المحددة</p></div><ChartNoAxesColumn /></div>
          {categoryTotals.length ? <div className="expense-category-list">{categoryTotals.map((a) => <div className="expense-category" key={a.id}>
            <div className="expense-category-label"><span>{a.name}</span><strong className="num">{formatMoney(a.total)}</strong></div>
            <div className="expense-bar"><span style={{ width: `${Math.max(4, a.total / maxCategory * 100)}%` }} /></div>
          </div>)}</div> : <div className="expense-chart-empty">لا توجد مصروفات مرحلة في الفترة المحددة.</div>}
        </section>
        <section className="card pad expense-period">
          <div className="expense-section-title"><div><h2>الفترة</h2><p className="muted">اختر تاريخ بداية ونهاية السجل</p></div><CalendarDays /></div>
          <label className="expense-filter-field">من تاريخ<DateInput className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="expense-filter-field">إلى تاريخ<DateInput className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn sm" onClick={() => { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }}>الشهر الحالي</button>
        </section>
      </div>

      <section className="card expense-history expense-category-report">
        <div className="expense-history-head"><div><h2>تقرير المصروفات بكل البنود</h2><p className="muted">من {from} إلى {to} · المستندات المرحلة فقط · حسب الفلاتر المختارة</p></div>
          <button className="btn sm" onClick={() => exportExcel('تقرير بنود المصروفات', ['البند', 'عدد العمليات', 'المبلغ', 'النسبة من الإجمالي'], categoryReport.map((a) => [a.name, a.count, formatMoney(a.total), `${postedTotal ? (a.total / postedTotal * 100).toFixed(1) : '0'}%`]))}>تصدير التقرير</button>
        </div>
        <div className="table-wrap"><table className="table responsive"><thead><tr><th>بند المصروف</th><th>عدد العمليات</th><th className="n">المبلغ</th><th>النسبة من الإجمالي</th></tr></thead>
          <tbody>{categoryReport.map((a) => <tr key={a.id}><td data-label="بند المصروف">{a.name}</td><td data-label="عدد العمليات" className="num">{a.count}</td><td data-label="المبلغ" className="n num bold">{formatMoney(a.total)}</td><td data-label="النسبة من الإجمالي" className="num">{postedTotal ? (a.total / postedTotal * 100).toFixed(1) : '0'}%</td></tr>)}</tbody>
          <tfoot><tr><th>الإجمالي</th><td className="num">{posted.length}</td><td className="n num bold">{formatMoney(postedTotal)}</td><td className="num">{postedTotal ? '100%' : '0%'}</td></tr></tfoot>
        </table></div>
      </section>

      <section className="card expense-history">
        <div className="expense-history-head"><div><h2>سجل المصروفات</h2><p className="muted">{list.length} مستند · المعروض {formatMoney(postedTotal)}</p></div></div>
        <div className="expense-filters">
          <label className="expense-search"><Search /><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث برقم المستند أو الملاحظات" /></label>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">كل بنود المصروف</option>{accounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select>
          <select className="select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}><option value="">كل الخزائن</option>{cashboxes.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">بانتظار المراجعة</option><option value="cancelled">ملغي</option></select>
        </div>
        {list.length === 0 ? <div className="expense-empty"><Empty icon={<Receipt />} title="لا توجد مصروفات مطابقة" /></div> : <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>رقم المستند</th><th>التاريخ</th><th>بند المصروف</th><th>الخزينة</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead>
            <tbody>{list.map((d) => <tr className="click" key={d.id} onClick={() => nav(`/docs/view/${d.id}`)}>
              <td data-label="رقم المستند" className="num bold">{d.number ?? d.local_number ?? '—'}</td>
              <td data-label="التاريخ" className="num">{d.date}</td>
              <td data-label="بند المصروف">{accountMap.get(d.account_id ?? '') ?? '—'}{d.notes && <small className="expense-note">{d.notes}</small>}</td>
              <td data-label="الخزينة">{cashboxMap.get(d.cashbox_id ?? '') ?? '—'}</td>
              <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
              <td data-label="المبلغ" className="n num bold">{formatMoney(d.total)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </div>
  );
}

export function ExpenseModal({ children, title = 'مصروف جديد', variant }: { children: ReactNode; title?: string; variant?: 'purchase' | 'receipt' }) {
  const nav = useNavigate();
  const location = useLocation();
  const close = () => {
    const background = (location.state as { backgroundLocation?: { pathname?: string; search?: string } } | null)?.backgroundLocation;
    if (background) nav(background, { replace: true });
    else nav(-1);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return <div className={`expense-modal-backdrop${variant ? ' purchase-modal-backdrop' : ''}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <section className={`expense-modal${variant === 'purchase' ? ' purchase-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="expense-modal-close icon-btn" onClick={close} aria-label="إغلاق"><X /></button>
      {children}
    </section>
  </div>;
}
