import { DOC_TYPES, formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, Landmark, Plus, Search, Wallet } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ActiveBadge, PageTabs, RowActions, TREASURY_TABS, TotalCards } from '../components/ListParts';
import { Banner, DateInput, DocStatusBadge, Empty, Field, MoneyInput, Segmented, Sheet, Switch, SyncBadge, exportExcel, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useRemote, useSession, userCashboxes } from '../lib/hooks';
import './expenses.css';

const INCOMING = new Set(['receipt', 'income', 'sale_invoice', 'purchase_return', 'partner_capital']);
const OUTGOING = new Set(['payment', 'expense', 'purchase_invoice', 'sale_return', 'partner_withdrawal', 'employee_advance', 'payroll']);

function cashAmount(document: any, cashboxId: string) {
  if (document.doc_type === 'cash_transfer') {
    if (document.to_cashbox_id === cashboxId) return document.total ?? document.amount ?? 0;
    if (document.cashbox_id === cashboxId) return -(document.total ?? document.amount ?? 0);
    return 0;
  }
  const payments = document.data?.payments ?? [];
  const paid = payments.filter((payment: any) => payment.cashbox_id === cashboxId).reduce((sum: number, payment: any) => sum + (payment.amount ?? 0), 0);
  const amount = paid || (document.cashbox_id === cashboxId ? document.total ?? document.amount ?? 0 : 0);
  if (INCOMING.has(document.doc_type)) return amount;
  if (OUTGOING.has(document.doc_type)) return -amount;
  return 0;
}

export function CashboxesPage() {
  const can = usePerm();
  const ui = useUi();
  const nav = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    const [cashboxes, users, documents] = await Promise.all([
      userCashboxes(session.user),
      db.users.toArray(),
      db.documents.toArray(),
    ]);
    const allowed = new Set(cashboxes.map((cashbox) => cashbox.id));
    const activity = documents
      .filter((document) => allowed.has(document.cashbox_id ?? '') || allowed.has(document.to_cashbox_id ?? '') || (document.data?.payments ?? []).some((payment: any) => allowed.has(payment.cashbox_id)))
      .sort((a, b) => String(b.date + (b.created_at ?? '')).localeCompare(String(a.date + (a.created_at ?? ''))));
    return { cashboxes, users, activity };
  }, [session.user.id, session.user.cashbox_ids?.join(',')]);
  const boxes = data?.cashboxes ?? [];
  const userName = useMemo(() => new Map((data?.users ?? []).map((user) => [user.id, user.full_name])), [data?.users]);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const shownBoxes = boxes.filter((box) => (kind === 'all' || box.kind === kind) && (status === 'all' || (status === 'active' ? box.active !== false : box.active === false)))
    .filter((box) => !query.trim() || [box.name, userName.get(box.user_id ?? '')].some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const current = shownBoxes.find((box) => box.id === sel) ?? shownBoxes[0] ?? boxes.find((box) => box.id === sel) ?? boxes[0];
  const mv = useRemote<any>(current && !current._sync ? `/api/reports/cashbox/${current.id}?from=${from}&to=${to}` : null, [current?.row_version]);
  const officialMovement = !mv.loading && mv.data?.cashbox?.id === current?.id ? mv.data : null;
  const currentActivity = (data?.activity ?? []).map((document) => ({ document, amount: current ? cashAmount(document, current.id) : 0 }))
    .filter(({ document, amount }) => amount && document.date >= from && document.date <= to);
  const incoming = currentActivity.filter(({ amount, document }) => amount > 0 && document.status === 'posted').reduce((sum, row) => sum + row.amount, 0);
  const outgoing = currentActivity.filter(({ amount, document }) => amount < 0 && document.status === 'posted').reduce((sum, row) => sum - row.amount, 0);
  const active = boxes.filter((box) => box.active !== false);
  const total = active.reduce((sum, box) => sum + (box.balance ?? 0), 0);
  const openNew = (type: 'receipt' | 'payment' | 'cash_transfer') => nav(`/docs/new/${type}`, { state: { backgroundLocation: location } });
  const exportActivity = () => current && exportExcel(`حركة ${current.name}`, ['التاريخ', 'المستند', 'النوع', 'الاتجاه', 'المبلغ', 'الحالة', 'ملاحظات'], currentActivity.map(({ document, amount }) => [document.date, document.number ?? document.local_number, DOC_TYPES[document.doc_type as keyof typeof DOC_TYPES]?.label ?? document.doc_type, amount > 0 ? 'وارد' : 'منصرف', formatMoney(Math.abs(amount)), document.status, document.notes ?? '']));

  return (
    <div className="page">
      <PageTabs tabs={TREASURY_TABS} />
      <PageHeader
        title="الخزائن والبنوك"
        actions={<>
          {can('treasury.create') && <button className="btn primary" disabled={!active.length} onClick={() => openNew('receipt')}><ArrowDownLeft /> قبض</button>}
          {can('treasury.create') && <button className="btn" disabled={!active.length} onClick={() => openNew('payment')}><ArrowUpRight /> صرف</button>}
          {can('treasury.create') && <button className="btn" disabled={active.length < 2} onClick={() => openNew('cash_transfer')}><ArrowLeftRight /> تحويل</button>}
          {can('treasury.manage') && <button className="btn" onClick={() => setEdit({})}><Plus /> خزينة أو بنك</button>}
        </>}
      />
      <TotalCards items={[
        { label: 'إجمالي الأرصدة المتاحة', value: formatMoney(total), tone: 'blue' },
        { label: 'الخزائن النقدية', value: formatMoney(active.filter((box) => box.kind !== 'bank').reduce((sum, box) => sum + (box.balance ?? 0), 0)), tone: 'green' },
        { label: 'الحسابات البنكية', value: formatMoney(active.filter((box) => box.kind === 'bank').reduce((sum, box) => sum + (box.balance ?? 0), 0)), tone: 'purple' },
      ]} />
      <div className="expense-filters">
        <label className="expense-search"><Search /><input className="input" aria-label="البحث في الخزائن والبنوك" placeholder="ابحث بالاسم أو الموظف المسؤول" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="select" aria-label="نوع الخزينة" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">كل الأنواع</option><option value="cash">الخزائن النقدية</option><option value="bank">الحسابات البنكية</option></select>
        <select className="select" aria-label="حالة الخزينة" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">النشطة</option><option value="inactive">الموقوفة</option><option value="all">كل الحالات</option></select>
      </div>
      <div className="table-wrap" style={{ marginBottom: 6 }}>
        <table className="table responsive">
          <thead><tr><th>الخزنة / البنك</th><th>المسؤول</th><th>الحالة</th><th className="n">الرصيد الحالي</th><th /></tr></thead>
          <tbody>
            {shownBoxes.map((b) => (
              <tr key={b.id} className={`click ${current?.id === b.id ? 'lp-sel' : ''}`} onClick={() => setSel(b.id)} aria-selected={current?.id === b.id}>
                <td data-label="الخزنة" className="bold"><span className="lp-kind">{b.kind === 'bank' ? <Landmark /> : <Wallet />}{b.name}</span></td>
                <td data-label="المسؤول" className="muted">{b.user_id ? userName.get(b.user_id) ?? '—' : 'بدون مسؤول'}</td>
                <td data-label="الحالة"><ActiveBadge active={b.active !== false} off="موقوفة" /></td>
                <td data-label="الرصيد الحالي" className="n bold">{formatMoney(b.balance ?? 0)}</td>
                <td data-label="" className="lp-act-cell">
                  <RowActions openLabel="عرض الحركة" onOpen={() => setSel(b.id)} onEdit={can('treasury.manage') ? () => setEdit(b) : undefined}>
                    <SyncBadge sync={b._sync} error={b._error} />
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shownBoxes.length && <Empty icon={<Wallet />} title={data === undefined ? 'جارٍ تحميل الخزائن…' : 'لا توجد خزائن مطابقة'} />}
      </div>

      {current && (
        <>
          <div className="row wrap" style={{ margin: '22px 0 10px' }}>
            <div className="section-title" style={{ margin: 0, flex: 1 }}>حركة {current.name}</div>
            <DateInput className="input" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <DateInput className="input" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn" disabled={!currentActivity.length} onClick={exportActivity}>تصدير الحركة</button>
          </div>
          <TotalCards items={[
            { label: 'الرصيد الحالي', value: formatMoney(current.balance ?? 0), tone: 'blue' },
            { label: 'الوارد في الفترة', value: formatMoney(incoming), tone: 'green' },
            { label: 'المنصرف في الفترة', value: formatMoney(outgoing), tone: 'red' },
          ]} />
          {mv.error && <Banner kind="warn">{mv.error}</Banner>}
          {officialMovement && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th className="n">وارد</th><th className="n">منصرف</th><th className="n">الرصيد</th></tr></thead>
                <tbody>
                  <tr><td colSpan={5} className="muted">رصيد أول المدة</td><td className="n bold">{formatMoney(officialMovement.opening)}</td></tr>
                  {officialMovement.lines.map((l: any, i: number) => (
                    <tr key={i} className={l.document_id ? 'click' : ''} onClick={() => l.document_id && nav(`/docs/view/${l.document_id}`)}>
                      <td data-label="التاريخ" className="num">{l.date}</td>
                      <td data-label="المستند" className="num">{l.doc_number}</td>
                      <td data-label="البيان">{l.memo ?? l.entry_memo}{l.party_name ? ` — ${l.party_name}` : ''}</td>
                      <td data-label="وارد" className="n green">{l.debit ? formatMoney(l.debit) : ''}</td>
                      <td data-label="منصرف" className="n red">{l.credit ? formatMoney(l.credit) : ''}</td>
                      <td data-label="الرصيد" className="n bold">{formatMoney(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={5}>الرصيد الختامي</td><td className="n">{formatMoney(officialMovement.closing)}</td></tr></tfoot>
              </table>
            </div>
          )}
          {!officialMovement && (
            <section className="card expense-history">
              <div className="expense-history-head"><div><h2>سجل الحركة المحلي</h2><p className="muted">متاح على الجهاز ويشمل المستندات المرتبطة بالخزينة، بما فيها العمليات المنتظرة للمزامنة.</p></div></div>
              {!currentActivity.length ? <div className="expense-empty"><Empty icon={<CalendarDays />} title="لا توجد حركة محلية في الفترة" /></div> : (
                <div className="table-wrap"><table className="table responsive">
                  <thead><tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>الحالة</th><th className="n">وارد</th><th className="n">منصرف</th></tr></thead>
                  <tbody>{currentActivity.map(({ document, amount }) => <tr key={document.id} className="click" onClick={() => nav(`/docs/view/${document.id}`)}>
                    <td data-label="التاريخ" className="num">{document.date}</td>
                    <td data-label="المستند" className="num bold">{document.number ?? document.local_number ?? '—'}</td>
                    <td data-label="النوع">{DOC_TYPES[document.doc_type as keyof typeof DOC_TYPES]?.label ?? document.doc_type}</td>
                    <td data-label="الحالة"><DocStatusBadge status={document.status} sync={document._sync} /></td>
                    <td data-label="وارد" className="n green">{amount > 0 ? formatMoney(amount) : ''}</td>
                    <td data-label="منصرف" className="n red">{amount < 0 ? formatMoney(-amount) : ''}</td>
                  </tr>)}</tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      )}

      {edit && (
        <CashboxEditor
          box={edit.id ? edit : null}
          onClose={() => setEdit(null)}
          onSave={async (d) => {
            await saveMaster('cashbox', edit.id ?? uuid(), d, edit.id ? edit : null);
            ui.toast('تم الحفظ');
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CashboxEditor({ box, onClose, onSave }: { box: any | null; onClose: () => void; onSave: (d: any) => Promise<void> }) {
  const [f, setF] = useState({ name: box?.name ?? '', kind: box?.kind ?? 'cash', active: box?.active ?? true, fee_pct: box?.fee_bp ? String(box.fee_bp / 100) : '0', fee_min: box?.fee_min ?? 0, fee_fixed: box?.fee_fixed ?? 0, user_id: (box?.user_id ?? '') as string });
  const users = useLiveQuery(async () => (await db.users.toArray()).filter((u) => u.active !== false).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar')), []) ?? [];
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (saving.current) return;
    const name = f.name.trim();
    const feePercent = Number(f.fee_pct || 0);
    if (!name) return setError('اكتب اسم الخزينة أو الحساب البنكي');
    if (!Number.isFinite(feePercent) || feePercent < 0 || f.fee_min < 0 || f.fee_fixed < 0) return setError('بيانات العمولة لازم تكون أرقامًا موجبة');
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, kind: f.kind, active: f.active, fee_bp: Math.round(feePercent * 100), fee_min: f.fee_min, fee_fixed: f.fee_fixed, user_id: f.user_id || null });
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet title={box ? 'تعديل خزينة' : 'خزينة / حساب بنكي جديد'} onClose={() => { if (!saving.current) onClose(); }} footer={<><button className="btn" disabled={busy} onClick={onClose}>إلغاء</button><button className="btn primary" aria-busy={busy} disabled={busy || !f.name.trim()} onClick={() => void save()}>حفظ</button></>}>
      <div className="stack">
        {error && <Banner kind="err">{error}</Banner>}
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        {!box && (
          <Field label="النوع" hint="يُنشأ لها حساب فرعي تلقائيًا في دليل الحسابات">
            <Segmented block value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'cash', label: 'خزينة نقدية' }, { value: 'bank', label: 'حساب بنكي' }]} />
          </Field>
        )}
        <Field label="الموظف المسؤول" hint="تُسمح له تلقائيًا وتكون خزنته الافتراضية في البيع والتحصيل">
          <select className="select" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
            <option value="">— بدون مسؤول —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
          </select>
        </Field>
        <div className="bold">عمولة طريقة السداد (بطاقات / محافظ)</div>
        <div className="grid grid-3">
          <Field label="النسبة %"><input className="input num" inputMode="decimal" value={f.fee_pct} onChange={(e) => setF({ ...f, fee_pct: e.target.value })} /></Field>
          <Field label="حد أدنى"><MoneyInput value={f.fee_min} onChange={(v) => setF({ ...f, fee_min: v })} /></Field>
          <Field label="مبلغ ثابت"><MoneyInput value={f.fee_fixed} onChange={(v) => setF({ ...f, fee_fixed: v })} /></Field>
        </div>
        <div className="footnote">تُخصم العمولة تلقائيًا من الخزينة على حساب «عمولات بنكية وعمولات الدفع» مع كل تحصيل عليها.</div>
        <div className="row"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} /> {f.active ? 'نشطة' : 'موقوفة'}</div>
        <div className="footnote">لتسجيل رصيد افتتاحي للخزينة استخدم «قيد يومية»: مدين الخزينة، دائن «أرصدة افتتاحية».</div>
      </div>
    </Sheet>
  );
}
