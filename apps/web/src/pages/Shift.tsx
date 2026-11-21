import { formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, Check, Clock, Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { PageTabs, TREASURY_TABS, TotalCards } from '../components/ListParts';
import { Banner, Empty, Field, MoneyInput, Sheet, exportExcel, useUi } from '../components/ui';
import { closeShift, openShift } from '../lib/actions';
import { db } from '../lib/db';
import { useRemote, useSession, userCashboxes } from '../lib/hooks';
import './expenses.css';

/** وردية الكاشير: فتح بعهدة، وإقفال بجرد نقدي، والفرق يُسجل عجزًا أو زيادة */
export function ShiftPage() {
  const { session } = useSession();
  const cashboxes = useLiveQuery(async () => (await userCashboxes(session.user)).filter((cashbox) => cashbox.kind === 'cash'), [session.user.id, session.user.cashbox_ids?.join(',')]) ?? [];
  const shifts = useLiveQuery(async () => (await db.cashier_shifts.where('user_id').equals(session.user.id).toArray()).sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))), []) ?? [];
  const open = shifts.find((s) => s.status === 'open');
  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [query, setQuery] = useState('');
  const exp = useRemote<any>(open && !open._sync ? `/api/shifts/${open.id}/expected` : null, [open?.row_version]);
  const cashboxNames = new Map(cashboxes.map((cashbox) => [cashbox.id, cashbox.name]));
  const closed = shifts.filter((shift) => shift.status === 'closed' && (!query.trim() || cashboxNames.get(shift.cashbox_id)?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const expected = exp.data?.expected ?? null;
  const exportHistory = () => exportExcel('سجل الورديات', ['الخزينة', 'بداية الوردية', 'نهاية الوردية', 'عهدة البداية', 'المتوقع', 'الفعلي', 'الفرق'], closed.map((shift) => [cashboxNames.get(shift.cashbox_id) ?? '', new Date(shift.opened_at).toLocaleString('ar-EG'), shift.closed_at ? new Date(shift.closed_at).toLocaleString('ar-EG') : '', formatMoney(shift.opening_float), shift.expected_cash != null ? formatMoney(shift.expected_cash) : '', shift.counted_cash != null ? formatMoney(shift.counted_cash) : '', shift.difference != null ? formatMoney(shift.difference) : '']));

  return (
    <div className="page expenses-page">
      <PageTabs tabs={TREASURY_TABS} />
      <PageHeader title="الوردية" actions={open
        ? <button className="btn primary" onClick={() => setDialog('close')}><Check /> مراجعة وإقفال الوردية</button>
        : <button className="btn primary" disabled={!cashboxes.length} onClick={() => setDialog('open')}><Plus /> فتح وردية</button>} />
      <TotalCards items={[
        { label: 'حالة الوردية', value: open ? 'مفتوحة' : 'مقفولة', tone: open ? 'green' : 'blue' },
        { label: 'عهدة البداية', value: formatMoney(open?.opening_float ?? 0), tone: 'purple' },
        { label: 'المتوقع في الدرج', value: expected == null ? '—' : formatMoney(expected), tone: 'orange' },
      ]} />
      {open ? (
        <section className="card pad stack">
          <div className="row wrap"><span className="badge green">وردية مفتوحة</span><span className="bold">{cashboxNames.get(open.cashbox_id) ?? 'خزينة غير متاحة'}</span><span className="spacer" /><span className="caption">منذ {new Date(open.opened_at).toLocaleString('ar-EG')}</span></div>
          {open._sync ? <Banner kind="info">الوردية محفوظة على الجهاز وبانتظار المزامنة. المتوقع يظهر بعد قبولها على الخادم.</Banner> : null}
          {exp.error ? <Banner kind="warn">{exp.error}</Banner> : null}
          <div className="grid grid-3">
            <div className="card pad"><span className="muted small">عهدة البداية</span><div className="bold num">{formatMoney(open.opening_float)}</div></div>
            <div className="card pad"><span className="muted small">صافي حركة الوردية</span><div className="bold num">{exp.data ? formatMoney(exp.data.movement) : '—'}</div></div>
            <div className="card pad"><span className="muted small">المتوقع في الدرج</span><div className="bold num">{expected == null ? '—' : formatMoney(expected)}</div></div>
          </div>
        </section>
      ) : (
        <section className="card"><Empty icon={<Clock />} title="لا توجد وردية مفتوحة">{cashboxes.length ? <button className="btn primary" onClick={() => setDialog('open')}><Plus /> فتح وردية</button> : <span className="muted">لا توجد خزينة نقدية مسموح بها للمستخدم.</span>}</Empty></section>
      )}
      <section className="card expense-history">
        <div className="expense-history-head"><div><h2>سجل الورديات</h2><p className="muted">{closed.length} وردية سابقة للمستخدم الحالي</p></div><button className="btn sm" disabled={!closed.length} onClick={exportHistory}>تصدير السجل</button></div>
        <div className="expense-filters"><label className="expense-search"><Search /><input className="input" aria-label="البحث في الورديات" placeholder="ابحث باسم الخزينة" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        {!closed.length ? <div className="expense-empty"><Empty icon={<CalendarClock />} title={shifts.some((shift) => shift.status === 'closed') ? 'لا توجد ورديات مطابقة' : 'لا توجد ورديات سابقة'} /></div> : (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>الخزينة</th><th>بداية الوردية</th><th>نهاية الوردية</th><th className="n">المتوقع</th><th className="n">الفعلي</th><th className="n">الفرق</th></tr></thead>
            <tbody>{closed.slice(0, 50).map((shift) => <tr key={shift.id}>
              <td data-label="الخزينة" className="bold">{cashboxNames.get(shift.cashbox_id) ?? '—'}</td>
              <td data-label="بداية الوردية" className="num">{new Date(shift.opened_at).toLocaleString('ar-EG')}</td>
              <td data-label="نهاية الوردية" className="num">{shift.closed_at ? new Date(shift.closed_at).toLocaleString('ar-EG') : '—'}</td>
              <td data-label="المتوقع" className="n">{shift.expected_cash != null ? formatMoney(shift.expected_cash) : '—'}</td>
              <td data-label="الفعلي" className="n">{shift.counted_cash != null ? formatMoney(shift.counted_cash) : '—'}</td>
              <td data-label="الفرق" className={`n bold ${shift.difference && shift.difference < 0 ? 'red' : shift.difference && shift.difference > 0 ? 'green' : ''}`}>{shift.difference != null ? formatMoney(shift.difference) : 'بانتظار المزامنة'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
      {dialog === 'open' ? <OpenShiftSheet cashboxes={cashboxes} userId={session.user.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'close' && open ? <CloseShiftSheet shift={open} expected={expected} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function OpenShiftSheet({ cashboxes, userId, onClose }: { cashboxes: any[]; userId: string; onClose: () => void }) {
  const ui = useUi();
  const [cashboxId, setCashboxId] = useState('');
  const [openingFloat, setOpeningFloat] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const cashbox = cashboxes.find((item) => item.id === (cashboxId || cashboxes[0]?.id));
  const save = async () => {
    if (saving.current) return;
    if (!cashbox) return setError('اختر خزينة نقدية مسموحًا بها');
    if (openingFloat < 0) return setError('عهدة البداية لا يمكن أن تكون سالبة');
    saving.current = true;
    setBusy(true);
    try {
      await openShift(uuid(), cashbox.id, openingFloat, userId);
      ui.toast('فُتحت الوردية');
      onClose();
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return <Sheet title="فتح وردية" onClose={() => { if (!saving.current) onClose(); }} footer={<><button className="btn" disabled={busy} onClick={onClose}>إلغاء</button><button className="btn primary" aria-busy={busy} disabled={busy || !cashbox} onClick={() => void save()}>فتح الوردية</button></>}>
    <div className="stack">
      {error ? <Banner kind="err">{error}</Banner> : null}
      <Field label="الخزينة النقدية"><select className="select" value={cashbox?.id ?? ''} onChange={(event) => setCashboxId(event.target.value)}>{cashboxes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="عهدة البداية" hint="النقدية الموجودة في درج الكاشير الآن"><MoneyInput value={openingFloat} onChange={setOpeningFloat} /></Field>
      {cashbox ? <div className="card pad"><span className="muted small">رصيد الخزينة الحالي</span><div className="bold num">{formatMoney(cashbox.balance ?? 0)}</div></div> : null}
    </div>
  </Sheet>;
}

function CloseShiftSheet({ shift, expected, onClose }: { shift: any; expected: number | null; onClose: () => void }) {
  const ui = useUi();
  const [counted, setCounted] = useState(expected ?? 0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const difference = expected == null ? null : counted - expected;
  const save = async () => {
    if (saving.current) return;
    if (counted < 0) return setError('النقدية الفعلية لا يمكن أن تكون سالبة');
    saving.current = true;
    setBusy(true);
    try {
      await closeShift(shift.id, counted, todayISO(), notes.trim() || undefined);
      ui.toast('أُقفلت الوردية');
      onClose();
    } catch (closeError) {
      setError((closeError as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return <Sheet title="مراجعة وإقفال الوردية" onClose={() => { if (!saving.current) onClose(); }} footer={<><button className="btn" disabled={busy} onClick={onClose}>رجوع</button><button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void save()}>إقفال الوردية</button></>}>
    <div className="stack">
      {error ? <Banner kind="err">{error}</Banner> : null}
      {expected == null ? <Banner kind="warn">المتوقع غير متاح حاليًا. اكتب النقدية الفعلية، وسيُحسب الفرق عند المزامنة.</Banner> : null}
      <div className="grid grid-2">
        <div className="card pad"><span className="muted small">المتوقع في الدرج</span><div className="bold num">{expected == null ? '—' : formatMoney(expected)}</div></div>
        <div className="card pad"><span className="muted small">الفرق المتوقع</span><div className={`bold num ${difference != null && difference < 0 ? 'red' : difference != null && difference > 0 ? 'green' : ''}`}>{difference == null ? 'يُحسب عند المزامنة' : `${formatMoney(difference)} ${difference < 0 ? '(عجز)' : difference > 0 ? '(زيادة)' : '(مطابق)'}`}</div></div>
      </div>
      <Field label="النقدية الفعلية بعد العد"><MoneyInput value={counted} onChange={setCounted} /></Field>
      <Field label="ملاحظات"><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    </div>
  </Sheet>;
}
