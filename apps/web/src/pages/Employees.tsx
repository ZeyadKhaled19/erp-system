import { formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, HandCoins, IdCard, Plus, Users, Wallet } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ActiveBadge, Avatar, PageTabs, RowActions, TotalCards } from '../components/ListParts';
import { Banner, DocStatusBadge, Empty, Field, MoneyInput, SearchBox, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveDocument, saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { useDebounced, usePerm } from '../lib/hooks';

/** تبويبات قسم الموظفين (نفس الشريط في الأربع صفحات) */
export const EMPLOYEE_TABS = [
  { to: '/employees', label: 'الموظفين', perm: 'employees.view' },
  { to: '/employees/attendance', label: 'الحضور والانصراف', perm: 'employees.view' },
  { to: '/employees/advances', label: 'السلف', perm: 'employees.view' },
  { to: '/employees/payroll', label: 'الرواتب', perm: 'employees.view' },
];

const useEmployees = () => useLiveQuery(async () => (await db.employees.toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')), []) ?? [];
const useCashboxes = () => useLiveQuery(async () => (await db.cashboxes.toArray()).filter((c) => c.active !== false), []) ?? [];

/** حقول المستند الافتراضية (المستندات بدون أصناف) */
const blankDoc = (extra: Record<string, any>) => ({
  id: uuid(), date: todayISO(), lines: [], journal_lines: [], payments: [], instruments: [], charges: [], paid: 0, amount: 0, discount: 0,
  reserve: false, deliver_later: false, retained_bp: 0, ...extra,
}) as any;

// =====================================================================================
// قائمة الموظفين
// =====================================================================================
export function EmployeesPage() {
  const can = usePerm();
  const nav = useNavigate();
  const employees = useEmployees();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [edit, setEdit] = useState<any | null>(null);
  const list = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return employees.filter((e) => !s || [e.name, e.code, e.phone, e.job_title].some((v) => v?.toLowerCase?.().includes(s)));
  }, [employees, dq]);
  const active = employees.filter((e) => e.active !== false);
  const salaries = active.reduce((s, e) => s + (e.salary ?? 0), 0);
  const advances = employees.reduce((s, e) => s + Math.max(0, e.advance_balance ?? 0), 0);

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الموظفين"
        sub={`${active.length} موظف نشط`}
        actions={can('employees.manage') && <button className="btn primary" onClick={() => setEdit({})}><Plus /> موظف جديد</button>}
      />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="ابحث عن موظف بالاسم أو الوظيفة أو الهاتف" /></div>
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<IdCard />} title={employees.length ? 'لا توجد نتائج' : 'لا يوجد موظفون بعد'}>
            {can('employees.manage') && !employees.length && <button className="btn primary" onClick={() => setEdit({})}><Plus /> أضف أول موظف</button>}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الهاتف</th><th className="n">الراتب</th><th className="n">رصيد السلف</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={can('employees.manage') ? 'click' : ''} onClick={() => can('employees.manage') && setEdit(e)}>
                  <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={e.name} />{e.name}</span></td>
                  <td data-label="الوظيفة">{e.job_title || <span className="muted">—</span>}</td>
                  <td data-label="الهاتف" className="num muted">{e.phone || '—'}</td>
                  <td data-label="الراتب" className="n">{formatMoney(e.salary ?? 0)}</td>
                  <td data-label="رصيد السلف" className={`n ${(e.advance_balance ?? 0) > 0 ? 'bold orange' : ''}`}>{formatMoney(e.advance_balance ?? 0)}</td>
                  <td data-label="الحالة"><ActiveBadge active={e.active !== false} /></td>
                  <td data-label="" className="lp-act-cell">
                    <RowActions
                      openLabel="كشف حساب السلف"
                      onOpen={can('reports.financial') && e.advance_account_id ? () => nav(`/reports/ledger?account=${e.advance_account_id}`) : undefined}
                      onEdit={can('employees.manage') ? () => setEdit(e) : undefined}
                    >
                      <SyncBadge sync={e._sync} error={e._error} />
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TotalCards items={[
        { label: 'عدد الموظفين النشطين', value: active.length, tone: 'blue' },
        { label: 'إجمالي الرواتب الشهرية', value: formatMoney(salaries), tone: 'green' },
        { label: 'إجمالي السلف المستحقة', value: formatMoney(advances), tone: 'orange' },
      ]} />
      {edit && <EmployeeEditor emp={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EmployeeEditor({ emp, onClose }: { emp: any | null; onClose: () => void }) {
  const ui = useUi();
  const [f, setF] = useState<any>(() => ({
    code: emp?.code ?? '', name: emp?.name ?? '', job_title: emp?.job_title ?? '', phone: emp?.phone ?? '', national_id: emp?.national_id ?? '',
    hire_date: emp?.hire_date ?? '', salary: emp?.salary ?? 0, notes: emp?.notes ?? '', active: emp?.active ?? true,
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return setErr('اسم الموظف مطلوب');
    try {
      await saveMaster('employee', emp?.id ?? uuid(), { ...f, name: f.name.trim(), hire_date: f.hire_date || null, code: f.code || null }, emp);
      ui.toast(emp ? 'تم تعديل بيانات الموظف' : 'تمت إضافة الموظف');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet title={emp ? `تعديل: ${emp.name}` : 'موظف جديد'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={() => void save()}>حفظ</button></>}>
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الموظف" required><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid grid-2">
          <Field label="الوظيفة"><input className="input" value={f.job_title} onChange={(e) => set('job_title', e.target.value)} placeholder="مثال: كاشير، أمين مخزن، محاسب" /></Field>
          <Field label="كود الموظف"><input className="input num" value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="الهاتف"><input className="input num" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="الرقم القومي"><input className="input num" value={f.national_id} onChange={(e) => set('national_id', e.target.value)} /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="الراتب الشهري" hint="يوم الغياب يُخصم بقيمة الراتب ÷ 30"><MoneyInput value={f.salary} onChange={(v) => set('salary', v)} /></Field>
          <Field label="تاريخ التعيين"><input type="date" className="input" value={f.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></Field>
        </div>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="row"><span style={{ flex: 1 }}>موظف نشط</span><Switch checked={f.active} onChange={(v) => set('active', v)} /></div>
      </div>
    </Sheet>
  );
}

// =====================================================================================
// الحضور والانصراف
// =====================================================================================
const STATUS: { id: 'present' | 'absent' | 'late' | 'leave'; label: string; tone: string }[] = [
  { id: 'present', label: 'حاضر', tone: 'green' },
  { id: 'late', label: 'متأخر', tone: 'orange' },
  { id: 'absent', label: 'غائب', tone: 'red' },
  { id: 'leave', label: 'إجازة', tone: 'blue' },
];

export function AttendancePage() {
  const can = usePerm();
  const ui = useUi();
  const employees = useEmployees().filter((e) => e.active !== false);
  const [date, setDate] = useState(todayISO());
  const records = useLiveQuery(() => db.attendance.where('date').equals(date).toArray(), [date]) ?? [];
  const byEmp = new Map(records.map((r) => [r.employee_id, r]));
  const editable = can('employees.attendance');
  const mark = async (empId: string, status: string) => {
    const existing = byEmp.get(empId);
    if (existing?.status === status) return;
    try {
      await saveMaster('attendance', existing?.id ?? `${empId}:${date}`, { employee_id: empId, date, status, notes: existing?.notes ?? null }, existing ?? null);
    } catch (e) {
      ui.toast((e as Error).message, 'err');
    }
  };
  const markAll = async () => {
    for (const e of employees) if (!byEmp.has(e.id)) await mark(e.id, 'present');
  };
  const count = (s: string) => records.filter((r) => r.status === s && employees.some((e) => e.id === r.employee_id)).length;
  const unmarked = employees.filter((e) => !byEmp.has(e.id)).length;

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الحضور والانصراف"
        sub="سجّل حالة كل موظف في اليوم — الغياب يُخصم تلقائيًا في مسير الرواتب"
        actions={<>
          <input type="date" className="input" style={{ width: 170 }} value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {editable && unmarked > 0 && <button className="btn primary" onClick={() => void markAll()}><CalendarCheck /> الباقين حاضرين ({unmarked})</button>}
        </>}
      />
      <TotalCards items={[
        { label: 'حاضر', value: count('present'), tone: 'green' },
        { label: 'متأخر', value: count('late'), tone: 'orange' },
        { label: 'غائب', value: count('absent'), tone: 'red' },
        { label: 'إجازة', value: count('leave'), tone: 'blue' },
      ]} />
      {employees.length === 0 ? (
        <div className="card"><Empty icon={<Users />} title="لا يوجد موظفون نشطون" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {employees.map((e) => {
                const r = byEmp.get(e.id);
                return (
                  <tr key={e.id}>
                    <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={e.name} />{e.name}</span></td>
                    <td data-label="الوظيفة" className="muted">{e.job_title || '—'}</td>
                    <td data-label="الحالة">
                      <div className="att-opts" role="radiogroup" aria-label={`حالة ${e.name}`}>
                        {STATUS.map((s) => (
                          <button key={s.id} type="button" role="radio" aria-checked={r?.status === s.id} disabled={!editable} className={`att-opt ${s.tone} ${r?.status === s.id ? 'on' : ''}`} onClick={() => void mark(e.id, s.id)}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td data-label="" className="lp-act-cell">{r ? <SyncBadge sync={r._sync} error={r._error} /> : <span className="badge gray">لم يُسجَّل</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// السلف
// =====================================================================================
export function AdvancesPage() {
  const can = usePerm();
  const nav = useNavigate();
  const employees = useEmployees();
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const docs = useLiveQuery(async () => (await db.documents.where('doc_type').equals('employee_advance').toArray()).sort((a, b) => String(b.date).localeCompare(String(a.date))), []) ?? [];
  const [open, setOpen] = useState(false);
  const outstanding = employees.filter((e) => (e.advance_balance ?? 0) > 0);

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="السلف"
        sub="السلفة تُصرف من الخزينة وتُخصم من راتب الموظف في مسير الرواتب"
        actions={can('employees.create') && <button className="btn primary" onClick={() => setOpen(true)}><HandCoins /> سلفة جديدة</button>}
      />
      {outstanding.length > 0 && (
        <TotalCards items={outstanding.slice(0, 6).map((e) => ({ label: `مستحق على ${e.name}`, value: formatMoney(e.advance_balance), tone: 'orange' as const }))} />
      )}
      {docs.length === 0 ? (
        <div className="card"><Empty icon={<HandCoins />} title="لا توجد سلف بعد" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>الموظف</th><th>ملاحظات</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}>
                  <td data-label="الرقم" className="num">{d.number ?? d.local_number}</td>
                  <td data-label="التاريخ" className="num">{d.date}</td>
                  <td data-label="الموظف" className="bold">{empName.get(d.employee_id) ?? '—'}</td>
                  <td data-label="ملاحظات" className="muted">{d.notes || '—'}</td>
                  <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                  <td data-label="المبلغ" className="n bold">{formatMoney(d.total ?? d.amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AdvanceSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function AdvanceSheet({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const employees = useEmployees().filter((e) => e.active !== false);
  const boxes = useCashboxes();
  const [f, setF] = useState({ employee_id: '', cashbox_id: '', amount: 0, date: todayISO(), notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const box = f.cashbox_id || boxes[0]?.id || '';
  const save = async () => {
    if (!f.employee_id) return setErr('اختر الموظف');
    if (!box) return setErr('اختر الخزينة');
    if (f.amount <= 0) return setErr('اكتب مبلغ السلفة');
    try {
      await saveDocument(blankDoc({ doc_type: 'employee_advance', employee_id: f.employee_id, cashbox_id: box, amount: f.amount, date: f.date, notes: f.notes || null }), 'post');
      ui.toast('تم تسجيل السلفة');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet title="سلفة جديدة" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={() => void save()}>حفظ وصرف السلفة</button></>}>
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="الموظف" required>
          <select className="select" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
            <option value="">اختر الموظف</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{(e.advance_balance ?? 0) > 0 ? ` — عليه ${formatMoney(e.advance_balance)}` : ''}</option>)}
          </select>
        </Field>
        <div className="grid grid-2">
          <Field label="المبلغ" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="التاريخ"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="تُصرف من">
          <select className="select" value={box} onChange={(e) => setF({ ...f, cashbox_id: e.target.value })}>
            {boxes.map((b) => <option key={b.id} value={b.id}>{b.name} — رصيدها {formatMoney(b.balance ?? 0)}</option>)}
          </select>
        </Field>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

// =====================================================================================
// مسير الرواتب
// =====================================================================================
const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (from: string) => (from ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : '—');

interface Row { employee_id: string; salary: number; absent_days: number; absence_deduction: number; bonus: number; other_deduction: number; advance_deduction: number }

export function PayrollPage() {
  const can = usePerm();
  const ui = useUi();
  const nav = useNavigate();
  const employees = useEmployees();
  const boxes = useCashboxes();
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const { from, to } = monthRange(ym);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [box, setBox] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const absences = useLiveQuery(async () => {
    const m = new Map<string, number>();
    (await db.attendance.where('date').between(from, to, true, true).toArray()).forEach((r) => r.status === 'absent' && m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + 1));
    return m;
  }, [from, to]) ?? new Map<string, number>();
  const runs = useLiveQuery(async () => (await db.documents.where('doc_type').equals('payroll').toArray()).sort((a, b) => String(b.data?.period_from ?? b.date).localeCompare(String(a.data?.period_from ?? a.date))), []) ?? [];
  const done = runs.find((d) => d.status !== 'cancelled' && (d.data?.period_from ?? d.period_from) === from);

  const rows: (Row & { name: string; job: string; balance: number; net: number })[] = employees
    .filter((e) => e.active !== false)
    .map((e) => {
      const days = absences.get(e.id) ?? 0;
      const base: Row = { employee_id: e.id, salary: e.salary ?? 0, absent_days: days, absence_deduction: Math.round(((e.salary ?? 0) / 30) * days), bonus: 0, other_deduction: 0, advance_deduction: 0 };
      const r = { ...base, ...(edits[e.id] ?? {}) } as Row;
      return { ...r, name: e.name, job: e.job_title ?? '', balance: Math.max(0, e.advance_balance ?? 0), net: r.salary + r.bonus - r.absence_deduction - r.other_deduction - r.advance_deduction };
    });
  const set = (id: string, k: keyof Row, v: number) => setEdits((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [k]: v } }));
  const sum = (k: 'salary' | 'bonus' | 'absence_deduction' | 'other_deduction' | 'advance_deduction' | 'net') => rows.reduce((s, r) => s + r[k], 0);
  const cashbox = box || boxes[0]?.id || '';

  const approve = async () => {
    setErr(null);
    const bad = rows.find((r) => r.net < 0);
    if (bad) return setErr(`صافي راتب «${bad.name}» بالسالب — راجع الخصومات`);
    const over = rows.find((r) => r.advance_deduction > r.balance);
    if (over) return setErr(`خصم السلفة لـ«${over.name}» أكبر من رصيد سلفه`);
    if (!cashbox) return setErr('اختر الخزينة التي تُصرف منها الرواتب');
    const ok = await ui.confirm({ title: `اعتماد رواتب ${monthLabel(from)}؟`, message: `سيتم صرف ${formatMoney(sum('net'))} من الخزينة لـ ${rows.length} موظف وترحيل القيد.`, confirmLabel: 'اعتماد وصرف' });
    if (!ok) return;
    setBusy(true);
    try {
      await saveDocument(blankDoc({
        doc_type: 'payroll', date: to > todayISO() ? todayISO() : to, cashbox_id: cashbox, period_from: from, period_to: to,
        payroll_rows: rows.map(({ employee_id, salary, absent_days, absence_deduction, bonus, other_deduction, advance_deduction }) => ({ employee_id, salary, absent_days, absence_deduction, bonus, other_deduction, advance_deduction })),
        notes: `رواتب ${monthLabel(from)}`,
      }), 'post');
      setEdits({});
      ui.toast('تم اعتماد المسير');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الرواتب"
        sub="الصافي = الراتب + المكافأة − الغياب − الجزاءات − خصم السلفة"
        actions={<input type="month" className="input" style={{ width: 180 }} value={ym} onChange={(e) => e.target.value && (setYm(e.target.value), setEdits({}))} />}
      />
      {err && <div style={{ marginBottom: 12 }}><Banner kind="err">{err}</Banner></div>}
      {done ? (
        <Banner kind="ok">رواتب {monthLabel(from)} معتمدة في المسير {done.number ?? done.local_number} بإجمالي {formatMoney(done.total)}. اختر شهرًا آخر لإعداد مسير جديد.</Banner>
      ) : rows.length === 0 ? (
        <div className="card"><Empty icon={<Wallet />} title="لا يوجد موظفون نشطون" /></div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الموظف</th><th className="n">الراتب</th><th className="n">أيام الغياب</th><th className="n">خصم الغياب</th><th className="n">مكافأة</th><th className="n">جزاءات</th><th className="n">خصم سلفة</th><th className="n">الصافي</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee_id}>
                    <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={r.name} />{r.name}</span>{r.job && <div className="muted small">{r.job}</div>}</td>
                    <td data-label="الراتب" className="n">{formatMoney(r.salary)}</td>
                    <td data-label="أيام الغياب" className="n">{r.absent_days}</td>
                    <td data-label="خصم الغياب" className="n pay-in"><MoneyInput value={r.absence_deduction} onChange={(v) => set(r.employee_id, 'absence_deduction', v)} /></td>
                    <td data-label="مكافأة" className="n pay-in"><MoneyInput value={r.bonus} onChange={(v) => set(r.employee_id, 'bonus', v)} /></td>
                    <td data-label="جزاءات" className="n pay-in"><MoneyInput value={r.other_deduction} onChange={(v) => set(r.employee_id, 'other_deduction', v)} /></td>
                    <td data-label="خصم سلفة" className="n pay-in">
                      <MoneyInput value={r.advance_deduction} onChange={(v) => set(r.employee_id, 'advance_deduction', v)} disabled={r.balance <= 0} />
                      {r.balance > 0 && <button type="button" className="pay-all" onClick={() => set(r.employee_id, 'advance_deduction', r.balance)}>رصيده {formatMoney(r.balance)}</button>}
                    </td>
                    <td data-label="الصافي" className={`n bold ${r.net < 0 ? 'red' : ''}`}>{formatMoney(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>الإجمالي ({rows.length} موظف)</td><td className="n">{formatMoney(sum('salary'))}</td><td /><td className="n">{formatMoney(sum('absence_deduction'))}</td><td className="n">{formatMoney(sum('bonus'))}</td><td className="n">{formatMoney(sum('other_deduction'))}</td><td className="n">{formatMoney(sum('advance_deduction'))}</td><td className="n">{formatMoney(sum('net'))}</td></tr></tfoot>
            </table>
          </div>
          {can('employees.create') && (
            <div className="pay-bar">
              <div className="si-grand pay-grand"><span>صافي رواتب {monthLabel(from)}</span><b className="num">{formatMoney(sum('net'))}</b></div>
              <Field label="تُصرف من">
                <select className="select" value={cashbox} onChange={(e) => setBox(e.target.value)}>
                  {boxes.map((b) => <option key={b.id} value={b.id}>{b.name} — رصيدها {formatMoney(b.balance ?? 0)}</option>)}
                </select>
              </Field>
              <button className="btn primary lg" disabled={busy} onClick={() => void approve()}>اعتماد وصرف الرواتب</button>
            </div>
          )}
        </>
      )}

      <div className="section-title">المسيرات السابقة</div>
      {runs.length === 0 ? (
        <div className="card pad muted">لا توجد مسيرات بعد</div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الرقم</th><th>الشهر</th><th>عدد الموظفين</th><th>الحالة</th><th className="n">الصافي المصروف</th><th /></tr></thead>
            <tbody>
              {runs.map((d) => (
                <Fragment key={d.id}>
                  <tr className="click" onClick={() => setOpenRun((o) => (o === d.id ? null : d.id))}>
                    <td data-label="الرقم" className="num">{d.number ?? d.local_number}</td>
                    <td data-label="الشهر" className="bold">{monthLabel(d.data?.period_from ?? d.period_from)}</td>
                    <td data-label="عدد الموظفين" className="num">{(d.data?.rows ?? d.payroll_rows ?? []).length}</td>
                    <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                    <td data-label="الصافي" className="n bold">{formatMoney(d.total ?? 0)}</td>
                    <td data-label="" className="lp-act-cell"><RowActions openLabel="عرض المستند" onOpen={() => nav(`/docs/view/${d.id}`)} /></td>
                  </tr>
                  {openRun === d.id && (
                    <tr className="group-row"><td colSpan={6}>
                      <table className="st-items-t"><tbody>
                        {(d.data?.rows ?? []).map((r: any) => (
                          <tr key={r.employee_id}><td>{r.name}</td><td className="n">راتب {formatMoney(r.salary)}</td><td className="n">غياب {r.absent_days} يوم (−{formatMoney(r.absence_deduction)})</td><td className="n">مكافأة {formatMoney(r.bonus)}</td><td className="n">جزاءات {formatMoney(r.other_deduction)}</td><td className="n">سلفة −{formatMoney(r.advance_deduction)}</td><td className="n"><b>{formatMoney(r.net)}</b></td></tr>
                        ))}
                      </tbody></table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
