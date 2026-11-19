import { formatMoney, hasPermission, todayISO, uuid, type DocInput } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, Plus, Receipt, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Field, MoneyInput, Sheet, useUi } from '../components/ui';
import { PageTabs, TREASURY_TABS } from '../components/ListParts';
import { QuickAccountSheet } from '../components/QuickAccount';
import { saveDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useSession, userCashboxes } from '../lib/hooks';
import './Expenses.css';

const monthStart = `${todayISO().slice(0, 7)}-01`;

export function ExpensesPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const autoOpened = useRef(false);
  const ui = useUi();
  const { session } = useSession();
  const can = (key: string) => hasPermission(session.user.permissions, key);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [cashboxFilter, setCashboxFilter] = useState('');
  const [status, setStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newAccount, setNewAccount] = useState<{ name: string } | null>(null);
  const [form, setForm] = useState({ date: todayISO(), account_id: '', cashbox_id: '', amount: 0, notes: '' });

  const docs = useLiveQuery(async () => (await db.documents.where('date').between(from, to, true, true).toArray())
    .filter((d) => d.doc_type === 'expense')
    .sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? ''))), [from, to]) ?? [];
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];
  const cashboxes = useLiveQuery(() => userCashboxes(session.user), []) ?? [];
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const cashboxMap = useMemo(() => new Map(cashboxes.map((c) => [c.id, c])), [cashboxes]);
  const expenseAccounts = useMemo(() => accounts.filter((a) => !a.is_group && a.active !== false && !['ar', 'ap', 'inventory', 'inventory_diff', 'cost_variance', 'sales', 'sales_returns', 'sales_discount', 'cash_over_short'].includes(a.system_key)), [accounts]);
  const posted = docs.filter((d) => d.status === 'posted');
  const total = posted.reduce((sum, d) => sum + d.amount, 0);
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    posted.forEach((d) => totals.set(d.account_id ?? '', (totals.get(d.account_id ?? '') ?? 0) + d.amount));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [posted]);
  const maxCategory = categoryTotals[0]?.[1] ?? 1;
  const visible = docs.filter((d) => {
    if (accountFilter && d.account_id !== accountFilter) return false;
    if (cashboxFilter && d.cashbox_id !== cashboxFilter) return false;
    if (status !== 'all' && d.status !== status) return false;
    const q = search.trim().toLocaleLowerCase();
    return !q || [d.number, d.local_number, d.notes, accountMap.get(d.account_id ?? '')?.name].some((v) => v?.toLocaleLowerCase().includes(q));
  });

  const startCreate = () => {
    setForm({ date: todayISO(), account_id: expenseAccounts[0]?.id ?? '', cashbox_id: cashboxes[0]?.id ?? '', amount: 0, notes: '' });
    setCreateOpen(true);
  };
  useEffect(() => {
    if (searchParams.get('new') !== '1' || autoOpened.current) return;
    autoOpened.current = true;
    setForm({ date: todayISO(), account_id: expenseAccounts[0]?.id ?? '', cashbox_id: cashboxes[0]?.id ?? '', amount: 0, notes: '' });
    setCreateOpen(true);
  }, [searchParams, expenseAccounts, cashboxes]);
  const saveExpense = async () => {
    if (!form.date || !form.account_id || !form.cashbox_id || form.amount <= 0) {
      ui.toast('أكمل التاريخ وبند المصروف والخزينة والمبلغ', 'err');
      return;
    }
    const ok = await ui.confirm({ title: 'حفظ المصروف؟', message: 'سيُخصم المبلغ من الخزينة ويُسجل على بند المصروف المختار.', confirmLabel: 'حفظ المصروف' });
    if (!ok) return;
    const doc: DocInput = {
      id: uuid(), doc_type: 'expense', date: form.date, party_id: null, warehouse_id: null, to_warehouse_id: null,
      cashbox_id: form.cashbox_id, to_cashbox_id: null, account_id: form.account_id, partner_id: null, sales_rep_id: null,
      price_list_id: null, shift_id: null, due_date: null, reserve: false, deliver_later: false, order_status: null,
      shipping_company: null, charges: [], from_quotation_id: null, payment_type: null, payments: [], instruments: [], paid: 0,
      amount: form.amount, discount: 0, ref_doc_id: null, side: null, notes: form.notes.trim() || null, local_number: null,
      retained_bp: 0, lines: [], journal_lines: [],
    };
    try {
      await saveDocument(doc, 'post');
      setCreateOpen(false);
      ui.toast('تم حفظ المصروف بنجاح', 'ok', { actions: [{ label: 'عرض المصروف', onClick: () => nav(`/docs/view/${doc.id}`) }] });
    } catch (e) {
      ui.toast((e as Error).message || 'تعذر حفظ المصروف', 'err');
    }
  };

  return (
    <div className="page">
      <PageTabs tabs={TREASURY_TABS} />
      <PageHeader title="المصروفات" sub="تابع المصروفات حسب الفترة والبند والخزينة، وسجّل مصروفًا جديدًا من نفس الشاشة." actions={can('treasury.create') ? <button className="btn primary" onClick={startCreate}><Plus /> مصروف جديد</button> : null} />
      {can('treasury.view') ? <>
      <div className="grid grid-4 expense-summary">
        <div className="card pad expense-kpi"><span className="caption">مصروفات الفترة</span><strong className="num">{formatMoney(total)}</strong><span className="muted small">المصروفات المرحلة</span></div>
        <div className="card pad expense-kpi"><span className="caption">عدد المصروفات</span><strong className="num">{posted.length}</strong><span className="muted small">ضمن الفترة المحددة</span></div>
        <div className="card pad expense-kpi"><span className="caption">متوسط المصروف</span><strong className="num">{formatMoney(posted.length ? total / posted.length : 0)}</strong><span className="muted small">لكل مصروف مرحّل</span></div>
        <div className="card pad expense-kpi"><span className="caption">أعلى بند</span><strong>{categoryTotals[0] ? accountMap.get(categoryTotals[0][0])?.name ?? '—' : '—'}</strong><span className="muted small">{categoryTotals[0] ? formatMoney(categoryTotals[0][1]) : 'لا توجد مصروفات'}</span></div>
      </div>

      <div className="card pad expense-categories">
        <div className="row between wrap"><div><h3 style={{ margin: 0 }}>توزيع المصروفات حسب البند</h3><div className="muted small">إجمالي المصروفات المرحلة في الفترة المحددة</div></div><strong className="num">{formatMoney(total)}</strong></div>
        {categoryTotals.length ? <div className="expense-category-list">{categoryTotals.slice(0, 6).map(([id, amount]) => <div className="expense-category-row" key={id}><div className="row between"><span>{accountMap.get(id)?.name ?? 'بدون بند'}</span><span className="num">{formatMoney(amount)} <small className="muted">{total ? Math.round(amount / total * 100) : 0}%</small></span></div><div className="expense-meter"><span style={{ width: `${Math.max(2, amount / maxCategory * 100)}%` }} /></div></div>)}</div> : <div className="empty small">لا توجد مصروفات مرحلة في هذه الفترة.</div>}
      </div>

      <div className="card expense-records">
        <div className="expense-filters">
          <label className="expense-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم البند أو رقم المستند أو الملاحظات" /></label>
          <label className="expense-date"><CalendarDays size={15} /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" /><span>إلى</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" /></label>
          <select className="select" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}><option value="">كل البنود</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="select" value={cashboxFilter} onChange={(e) => setCashboxFilter(e.target.value)}><option value="">كل الخزائن</option>{cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">كل الحالات</option><option value="posted">مرحّل</option><option value="draft">مسودة</option><option value="pending_review">مراجعة</option></select>
        </div>
        {visible.length ? <div className="table-wrap"><table className="table responsive"><thead><tr><th>رقم المستند</th><th>التاريخ</th><th>بند المصروف</th><th>الخزينة</th><th>ملاحظات</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead><tbody>{visible.map((d) => <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}><td data-label="رقم المستند" className="num bold">{d.number ?? d.local_number ?? 'مسودة'}</td><td data-label="التاريخ" className="num">{d.date}</td><td data-label="بند المصروف">{accountMap.get(d.account_id ?? '')?.name ?? '—'}</td><td data-label="الخزينة">{cashboxMap.get(d.cashbox_id ?? '')?.name ?? '—'}</td><td data-label="ملاحظات" className="muted">{d.notes || '—'}</td><td data-label="الحالة"><span className={`badge ${d.status === 'posted' ? 'green' : d.status === 'draft' ? 'gray' : 'orange'}`}>{d.status === 'posted' ? 'مرحّل' : d.status === 'draft' ? 'مسودة' : 'مراجعة'}</span></td><td data-label="المبلغ" className="n num bold">{formatMoney(d.amount)}</td></tr>)}</tbody></table></div> : <div className="expense-empty"><Receipt /><strong>لا توجد مصروفات مطابقة</strong><span>غيّر الفترة أو الفلاتر، أو أضف مصروفًا جديدًا.</span>{can('treasury.create') && <button className="btn" onClick={startCreate}><Plus /> مصروف جديد</button>}</div>}
        <div className="expense-list-foot">عرض {visible.length} من {docs.length} مصروف</div>
      </div>
      </> : <Banner kind="info">تقدر تسجّل مصروفًا جديدًا من النافذة، لكن صلاحيتك لا تشمل عرض سجل المصروفات.</Banner>}

      {createOpen && <Sheet title="مصروف جديد" subtitle="أدخل التفاصيل الأساسية، وسيُسجل المبلغ على الخزينة وبند المصروف." onClose={() => setCreateOpen(false)} footer={<><button className="btn" onClick={() => setCreateOpen(false)}>إلغاء</button><button className="btn primary" onClick={() => void saveExpense()}>حفظ المصروف</button></>}>
        <div className="stack">
          <div className="grid grid-2">
            <Field label="التاريخ"><input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="المبلغ"><MoneyInput value={form.amount} onChange={(amount) => setForm((f) => ({ ...f, amount }))} /></Field>
          </div>
          <Field label="بند المصروف" required><div className="row"><select className="select" value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}><option value="">اختر بند المصروف</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{can('accounts.manage') && <button className="icon-btn" type="button" title="إضافة بند مصروف" onClick={() => setNewAccount({ name: '' })}><Plus /></button>}</div></Field>
          <Field label="الخزينة" required><select className="select" value={form.cashbox_id} onChange={(e) => setForm((f) => ({ ...f, cashbox_id: e.target.value }))}><option value="">اختر الخزينة</option>{cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="ملاحظات"><textarea className="textarea" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="تفاصيل اختيارية للمصروف" /></Field>
          {!cashboxes.length && <Banner kind="warn">لا توجد خزينة متاحة لحسابك. أضف خزينة أو اطلب صلاحية الوصول إليها قبل التسجيل.</Banner>}
        </div>
      </Sheet>}
      {newAccount && <QuickAccountSheet type="expense" initialName={newAccount.name} onClose={() => setNewAccount(null)} onSaved={(id) => { setForm((f) => ({ ...f, account_id: id })); setNewAccount(null); }} />}
    </div>
  );
}
