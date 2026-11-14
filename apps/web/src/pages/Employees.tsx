import { formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, HandCoins, IdCard, Plus, Users, UserX, Wallet } from 'lucide-react';
import { QuickActions, SectionStats } from '../components/Section';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ActiveBadge, Avatar, PageTabs, RowActions, TotalCards } from '../components/ListParts';
import { Banner, DocStatusBadge, Empty, exportExcel, Field, MoneyInput, SearchBox, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveDocument, saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { useDebounced, usePerm, useSettings } from '../lib/hooks';
import { deptPath, deptTree, DeptSelect, useDeptFilter, useDeptMatcher, useJobTitles, withChildren } from '../lib/org';

/** تبويبات قسم الموظفين (نفس الشريط في الأربع صفحات) */
export const EMPLOYEE_TABS = [
  { to: '/employees', label: 'الموظفين', perm: 'employees.view' },
  { to: '/employees/org', label: 'الهيكل التنظيمي', perm: 'employees.view' },
  { to: '/employees/attendance', label: 'الحضور والانصراف', perm: 'employees.view' },
  { to: '/employees/attendance-report', label: 'مراجعة الحضور', perm: 'employees.view' },
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
  const [dept, setDept] = useDeptFilter();
  const { depts, match } = useDeptMatcher(dept);
  const titles = useJobTitles();
  const jobOf = (e: any) => (e.job_title_id && titles.find((t) => t.id === e.job_title_id)?.name) || e.job_title || '';
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const list = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return employees.filter((e) => match(e) && (!s || [e.name, e.code, e.phone, e.job_title, deptPath(depts, e.department_id)].some((v) => v?.toLowerCase?.().includes(s))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, dq, dept, depts]);
  const active = list.filter((e) => e.active !== false);
  const salaries = active.reduce((s, e) => s + (e.salary ?? 0), 0);
  const advances = list.reduce((s, e) => s + Math.max(0, e.advance_balance ?? 0), 0);
  // حضور النهارده للموظفين المعروضين (نفس فلتر الإدارة)
  const todayRecs = useLiveQuery(() => db.attendance.where('date').equals(todayISO()).toArray(), []) ?? [];
  const shownIds = new Set(active.map((e) => e.id));
  const todayOf = (st: string[]) => todayRecs.filter((r) => shownIds.has(r.employee_id) && st.includes(r.status)).length;
  const unmarked = active.filter((e) => !todayRecs.some((r) => r.employee_id === e.id)).length;

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الموظفين"
        sub={`${active.length} موظف نشط`}
        actions={can('employees.manage') && <button className="btn primary" onClick={() => setEdit({})}><Plus /> موظف جديد</button>}
      />
      <div className="sx-top">
        <SectionStats items={[
          { key: 'active', label: 'الموظفين النشطين', value: active.length, sub: dept ? 'في الإدارة المختارة' : undefined, icon: <Users />, color: 'blue' },
          { key: 'present', label: 'حاضرين النهارده', value: todayOf(['present', 'late']), sub: todayOf(['late']) ? `منهم ${todayOf(['late'])} متأخر` : unmarked ? `${unmarked} لسه ما اتسجلش` : undefined, icon: <CalendarCheck />, color: 'green', valueTone: 'green', to: '/employees/attendance' },
          { key: 'absent', label: 'غياب وأجازات النهارده', value: todayOf(['absent', 'leave']), sub: `${todayOf(['absent'])} غياب · ${todayOf(['leave'])} أجازة`, icon: <UserX />, color: 'red', valueTone: todayOf(['absent']) ? 'red' : undefined, to: '/employees/attendance' },
          { key: 'adv', label: 'السلف المستحقة', value: formatMoney(advances), icon: <HandCoins />, color: 'orange', to: '/employees/advances' },
          { key: 'sal', label: 'الرواتب الشهرية', value: formatMoney(salaries), icon: <Wallet />, color: 'purple', to: '/employees/payroll' },
        ]} />
        <QuickActions section="employees" defaults={['attendance', 'employee_advance', 'payroll']} />
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="ابحث عن موظف بالاسم أو الوظيفة أو الإدارة أو الهاتف" /></div>
        <DeptSelect value={dept} onChange={setDept} depts={depts} width={220} />
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
            <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الإدارة</th><th>بيتبع</th><th>الهاتف</th><th className="n">الراتب</th><th className="n">رصيد السلف</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={can('employees.manage') ? 'click' : ''} onClick={() => can('employees.manage') && setEdit(e)}>
                  <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={e.name} />{e.name}</span></td>
                  <td data-label="الوظيفة">{jobOf(e) || <span className="muted">—</span>}</td>
                  <td data-label="الإدارة">{deptPath(depts, e.department_id) || <span className="muted">—</span>}</td>
                  <td data-label="بيتبع">{empName.get(e.manager_id) ?? <span className="muted">—</span>}</td>
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
      {edit && <EmployeeEditor emp={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function EmployeeEditor({ emp, onClose }: { emp: any | null; onClose: () => void }) {
  const ui = useUi();
  const all = useEmployees();
  const titles = useJobTitles();
  const { depts } = useDeptMatcher('');
  const [f, setF] = useState<any>(() => ({
    code: emp?.code ?? '', name: emp?.name ?? '', job_title: emp?.job_title ?? '', phone: emp?.phone ?? '', national_id: emp?.national_id ?? '',
    hire_date: emp?.hire_date ?? '', salary: emp?.salary ?? 0, notes: emp?.notes ?? '', active: emp?.active ?? true,
    department_id: emp?.department_id ?? '', job_title_id: emp?.job_title_id ?? '', manager_id: emp?.manager_id ?? '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  // المدير المباشر: مش الموظف نفسه ولا حد من اللي تحته
  const under = useMemo(() => {
    const out = new Set<string>(emp?.id ? [emp.id] : []);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of all) if (e.manager_id && out.has(e.manager_id) && !out.has(e.id)) { out.add(e.id); grew = true; }
    }
    return out;
  }, [all, emp?.id]);
  const managers = all.filter((e) => !under.has(e.id) && (e.active !== false || e.id === f.manager_id));
  const deptMgr = all.find((e) => e.id === depts.find((d) => d.id === f.department_id)?.manager_id);
  const save = async () => {
    if (!f.name.trim()) return setErr('اسم الموظف مطلوب');
    const title = titles.find((t) => t.id === f.job_title_id);
    try {
      await saveMaster('employee', emp?.id ?? uuid(), {
        ...f, name: f.name.trim(), hire_date: f.hire_date || null, code: f.code || null,
        department_id: f.department_id || null, job_title_id: f.job_title_id || null, manager_id: f.manager_id || null,
        // اسم الوظيفة يتحفظ كمان نصًا (والنص القديم يفضل لو لسه ما اتربطش بوظيفة من القائمة)
        job_title: title?.name ?? (f.job_title_id ? f.job_title : f.job_title || null),
      }, emp);
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
          <Field label="الوظيفة" hint={!titles.length ? 'أضف الوظائف من «الهيكل التنظيمي ← الوظائف»' : !f.job_title_id && f.job_title ? `مكتوبة قبل كده: ${f.job_title}` : undefined}>
            <select className="select" value={f.job_title_id} onChange={(e) => set('job_title_id', e.target.value)}>
              <option value="">— اختر الوظيفة —</option>
              {titles.filter((t) => t.active !== false || t.id === f.job_title_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="كود الموظف"><input className="input num" value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="الإدارة" hint={!depts.length ? 'أضف الإدارات من «الهيكل التنظيمي»' : undefined}>
            <select className="select" value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">— من غير إدارة —</option>
              {deptTree(depts).filter(({ d }) => d.active !== false || d.id === f.department_id).map(({ d, depth }) => <option key={d.id} value={d.id}>{'  '.repeat(depth)}{depth ? '└ ' : ''}{d.name}</option>)}
            </select>
          </Field>
          <Field label="بيتبع مين (المدير المباشر)">
            <select className="select" value={f.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
              <option value="">— مش تابع لحد —</option>
              {managers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {deptMgr && !under.has(deptMgr.id) && f.manager_id !== deptMgr.id && (
              <button type="button" className="pay-all" onClick={() => set('manager_id', deptMgr.id)}>مدير الإدارة: {deptMgr.name}</button>
            )}
          </Field>
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

/** الوقت الحالي على الجهاز (ساعة:دقيقة) */
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** عرض الوقت بنظام 12 ساعة (9:05 ص) */
const fmtTime = (t?: string | null) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};
const minutesOf = (r: any) => {
  if (!r?.check_in || !r?.check_out) return 0;
  const [a, b] = [r.check_in, r.check_out].map((t: string) => t.split(':').map(Number));
  return Math.max(0, b[0] * 60 + b[1] - (a[0] * 60 + a[1]));
};
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/** مواعيد الشغل من الإعدادات (بقيم افتراضية لو لسه ما اتحددتش) */
function useWorkRules() {
  const s = useSettings();
  const start: string = typeof s.work_start_time === 'string' ? s.work_start_time : '09:00';
  const grace = Number.isFinite(Number(s.late_grace_minutes)) ? Number(s.late_grace_minutes) : 15;
  const end: string = typeof s.work_end_time === 'string' ? s.work_end_time : '17:00';
  const offDays: number[] = Array.isArray(s.weekly_off_days) ? s.weekly_off_days : [];
  const leaveDays = Number.isFinite(Number(s.monthly_leave_days)) ? Number(s.monthly_leave_days) : 4;
  return {
    start, end, grace, offDays, leaveDays,
    /** دقائق الانصراف المبكر عن ميعاد الانصراف (لمن خرج قبل الميعاد − فترة السماح فقط) */
    earlyMinutes: (t?: string | null) => (t && toMin(t) < toMin(end) - grace ? toMin(end) - toMin(t) : 0),
    /** متأخر لو الحضور بعد الميعاد + فترة السماح */
    isLate: (t: string) => toMin(t) > toMin(start) + grace,
    /** دقائق التأخير عن ميعاد البداية (لمن تعدّى فترة السماح فقط) */
    lateMinutes: (t?: string | null) => (t && toMin(t) > toMin(start) + grace ? toMin(t) - toMin(start) : 0),
    isOff: (date: string) => offDays.includes(new Date(date + 'T00:00:00Z').getUTCDay()),
  };
}
const fmtHours = (min: number) => (min ? `${Math.floor(min / 60)}س ${String(min % 60).padStart(2, '0')}د` : '—');

/** خانة وقت: زرار «تسجيل» بيختم الوقت الحالي (لليوم)، وبعدها الوقت نفسه قابل للتعديل */
function TimeCell({ value, onSet, stamp, label, disabled }: { value?: string | null; onSet: (t: string | null) => void; stamp: boolean; label: string; disabled?: boolean }) {
  if (!value && stamp && !disabled) {
    return <button type="button" className="btn sm primary att-stamp" onClick={() => onSet(nowHM())}>{label}</button>;
  }
  return (
    <input
      type="time"
      className="input att-time num"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onSet(e.target.value || null)}
    />
  );
}

export function AttendancePage() {
  const can = usePerm();
  const ui = useUi();
  const [dept, setDept] = useDeptFilter();
  const { depts, match } = useDeptMatcher(dept);
  const employees = useEmployees().filter((e) => e.active !== false && match(e));
  const [date, setDate] = useState(todayISO());
  const records = useLiveQuery(() => db.attendance.where('date').equals(date).toArray(), [date]) ?? [];
  const byEmp = new Map(records.map((r) => [r.employee_id, r]));
  const editable = can('employees.attendance');
  const isToday = date === todayISO();
  const rules = useWorkRules();
  // الأجازات المستخدمة في شهر اليوم المختار (لكل موظف من رصيده الشهري)
  const mr = monthRange(date.slice(0, 7));
  const leaveUsed = useLiveQuery(async () => {
    const m = new Map<string, number>();
    (await db.attendance.where('date').between(mr.from, mr.to, true, true).toArray()).forEach((r) => r.status === 'leave' && m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + 1));
    return m;
  }, [mr.from, mr.to]) ?? new Map<string, number>();
  const offDay = rules.isOff(date);
  const write = async (empId: string, patch: Record<string, any>) => {
    const existing = byEmp.get(empId);
    const next = { status: 'present', check_in: null, check_out: null, notes: null, ...(existing ?? {}), ...patch };
    // الغائب أو في إجازة ملوش أوقات
    if (next.status === 'absent' || next.status === 'leave') Object.assign(next, { check_in: null, check_out: null });
    if (!next.check_in) next.check_out = null;
    try {
      await saveMaster('attendance', existing?.id ?? `${empId}:${date}`, { employee_id: empId, date, status: next.status, check_in: next.check_in, check_out: next.check_out, notes: next.notes }, existing ?? null);
    } catch (e) {
      ui.toast((e as Error).message, 'err');
    }
  };
  const mark = (empId: string, status: string) => {
    if (byEmp.get(empId)?.status === status) return;
    if (status === 'leave' && (leaveUsed.get(empId) ?? 0) >= rules.leaveDays) {
      ui.toast(`الموظف خلّص أجازاته (${rules.leaveDays} أيام في الشهر) — اليوم ده هيتخصم زي الغياب في الرواتب`, 'err');
    }
    return write(empId, { status });
  };
  const setIn = (empId: string, t: string | null) => {
    const r = byEmp.get(empId);
    if (t && r?.check_out && r.check_out < t) return ui.toast('وقت الحضور بعد وقت الانصراف', 'err');
    // الحالة تتحدد من ميعاد بداية الشغل + فترة السماح (وتقدر تغيّرها بعدها)
    return write(empId, { check_in: t, status: t && rules.isLate(t) ? 'late' : 'present' });
  };
  const setOut = (empId: string, t: string | null) => {
    const r = byEmp.get(empId);
    if (t && r?.check_in && t < r.check_in) return ui.toast('وقت الانصراف قبل وقت الحضور', 'err');
    return write(empId, { check_out: t });
  };
  const markAll = async () => {
    for (const e of employees) if (!byEmp.has(e.id)) await write(e.id, { status: 'present' });
  };
  const count = (s: string) => records.filter((r) => r.status === s && employees.some((e) => e.id === r.employee_id)).length;
  const unmarked = employees.filter((e) => !byEmp.has(e.id)).length;
  const inside = records.filter((r) => r.check_in && !r.check_out).length;

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الحضور والانصراف"
        sub={`${isToday ? 'اضغط «تسجيل حضور» عند وصول الموظف و«تسجيل انصراف» عند خروجه — الوقت يتسجل بالظبط' : 'يوم سابق: اكتب الأوقات بنفسك لو محتاج تصحيح'} · الشغل من ${fmtTime(rules.start)} لـ ${fmtTime(rules.end)} وسماح ${rules.grace} دقيقة`}
        actions={<>
          <DeptSelect value={dept} onChange={setDept} depts={depts} />
          <input type="date" className="input" style={{ width: 170 }} value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {editable && unmarked > 0 && !isToday && <button className="btn" onClick={() => void markAll()}><CalendarCheck /> الباقين حاضرين ({unmarked})</button>}
        </>}
      />
      {offDay && <div style={{ marginBottom: 12 }}><Banner kind="info">اليوم ده أجازة أسبوعية حسب الإعدادات — تقدر تسجّل لو فيه حد شغال.</Banner></div>}
      <TotalCards items={[
        { label: 'حاضر', value: count('present'), tone: 'green' },
        { label: 'متأخر', value: count('late'), tone: 'orange' },
        { label: 'غائب', value: count('absent'), tone: 'red' },
        { label: isToday ? 'لسه في الشغل' : 'إجازة', value: isToday ? inside : count('leave'), tone: 'blue' },
      ]} />
      {employees.length === 0 ? (
        <div className="card"><Empty icon={<Users />} title="لا يوجد موظفون نشطون" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive att-table">
            <thead><tr><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {employees.map((e) => {
                const r = byEmp.get(e.id);
                const off = r?.status === 'absent' || r?.status === 'leave';
                return (
                  <tr key={e.id}>
                    <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={e.name} />{e.name}</span>
                      <div className={`small ${(leaveUsed.get(e.id) ?? 0) > rules.leaveDays ? 'red' : 'muted'}`}>{e.job_title ? `${e.job_title} · ` : ''}أجازات الشهر {leaveUsed.get(e.id) ?? 0} من {rules.leaveDays}</div>
                    </td>
                    <td data-label="الحضور"><TimeCell value={r?.check_in} stamp={isToday} label="تسجيل حضور" disabled={!editable || off} onSet={(t) => void setIn(e.id, t)} /></td>
                    <td data-label="الانصراف"><TimeCell value={r?.check_out} stamp={isToday} label="تسجيل انصراف" disabled={!editable || off || !r?.check_in} onSet={(t) => void setOut(e.id, t)} /></td>
                    <td data-label="ساعات العمل" className="num bold">
                      {r?.check_in && !r?.check_out ? <span className="badge blue">في الشغل</span> : fmtHours(minutesOf(r))}
                      {rules.earlyMinutes(r?.check_out) > 0 && <div><span className="badge orange">انصراف مبكر {fmtHours(rules.earlyMinutes(r?.check_out))}</span></div>}
                    </td>
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
// مراجعة الحضور الشهرية
// =====================================================================================
const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const STATUS_LABEL: Record<string, { label: string; tone: string }> = Object.fromEntries(STATUS.map((s) => [s.id, { label: s.label, tone: s.tone }]));

export function AttendanceReportPage() {
  const [dept, setDept] = useDeptFilter();
  const { depts, match } = useDeptMatcher(dept);
  const employees = useEmployees().filter(match);
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const [empId, setEmpId] = useState('');
  const { from, to } = monthRange(ym);
  const recs = useLiveQuery(() => db.attendance.where('date').between(from, to, true, true).toArray(), [from, to]) ?? [];
  const rules = useWorkRules();
  const today = todayISO();
  const lastDay = to < today ? to : today;
  const days: string[] = [];
  for (let d = from; d <= lastDay; ) {
    days.push(d);
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + 1);
    d = x.toISOString().slice(0, 10);
  }
  const shown = employees.filter((e) => e.active !== false || recs.some((r) => r.employee_id === e.id));
  const summary = shown.map((e) => {
    const mine = recs.filter((r) => r.employee_id === e.id);
    const ins = mine.filter((r) => r.check_in).map((r) => r.check_in.split(':').map(Number)).map(([h, m]: number[]) => h * 60 + m);
    const avgIn = ins.length ? Math.round(ins.reduce((s: number, v: number) => s + v, 0) / ins.length) : null;
    return {
      e,
      present: mine.filter((r) => r.status === 'present').length,
      late: mine.filter((r) => r.status === 'late').length,
      absent: mine.filter((r) => r.status === 'absent').length,
      leave: mine.filter((r) => r.status === 'leave').length,
      // الأيام بدون تسجيل (من غير أيام الأجازة الأسبوعية)
      missing: days.filter((d) => !rules.isOff(d) && !mine.some((r) => String(r.date).slice(0, 10) === d)).length,
      minutes: mine.reduce((s, r) => s + minutesOf(r), 0),
      lateMin: mine.reduce((s, r) => s + rules.lateMinutes(r.check_in), 0),
      earlyMin: mine.reduce((s, r) => s + rules.earlyMinutes(r.check_out), 0),
      avgIn: avgIn === null ? null : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`,
    };
  });
  const emp = employees.find((e) => e.id === empId);
  const byDay = new Map(recs.filter((r) => r.employee_id === empId).map((r) => [String(r.date).slice(0, 10), r]));
  const one = summary.find((s) => s.e.id === empId);

  const exportAll = () => exportExcel(`حضور ${monthLabel(from)}`, ['الموظف', 'الوظيفة', 'حاضر', 'متأخر', 'غائب', `إجازة (من ${rules.leaveDays})`, 'أجازات زيادة', 'أيام بدون تسجيل', 'إجمالي الساعات', 'إجمالي التأخير', 'انصراف مبكر', 'متوسط وقت الحضور'],
    summary.map((s) => [s.e.name, s.e.job_title ?? '', s.present, s.late, s.absent, s.leave, Math.max(0, s.leave - rules.leaveDays), s.missing, fmtHours(s.minutes), fmtHours(s.lateMin), fmtHours(s.earlyMin), s.avgIn ? fmtTime(s.avgIn) : '—']));
  const exportOne = () => emp && exportExcel(`حضور ${emp.name} ${monthLabel(from)}`, ['التاريخ', 'اليوم', 'الحالة', 'الحضور', 'الانصراف', 'ساعات العمل', 'التأخير', 'انصراف مبكر'],
    days.map((d) => { const r = byDay.get(d); return [d, DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()], r ? STATUS_LABEL[r.status]?.label : rules.isOff(d) ? 'أجازة أسبوعية' : 'لم يُسجَّل', fmtTime(r?.check_in), fmtTime(r?.check_out), fmtHours(minutesOf(r)), fmtHours(rules.lateMinutes(r?.check_in)), fmtHours(rules.earlyMinutes(r?.check_out))]; }));

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="مراجعة الحضور"
        sub={`${monthLabel(from)} — ${days.length} يوم`}
        actions={<>
          <input type="month" className="input" style={{ width: 180 }} value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
          <DeptSelect value={dept} onChange={(v) => { setDept(v); setEmpId(''); }} depts={depts} />
          <select className="select" style={{ width: 220 }} value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="">كل الموظفين (ملخص)</option>
            {shown.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn" onClick={() => void (empId ? exportOne() : exportAll())}>تصدير Excel</button>
        </>}
      />
      <div className="footnote" style={{ margin: '-6px 0 12px' }}>الشغل من {fmtTime(rules.start)} لـ {fmtTime(rules.end)} · سماح {rules.grace} دقيقة · {rules.leaveDays} أيام أجازة متغيرة في الشهر{rules.offDays.length ? ` · أجازة ثابتة: ${rules.offDays.map((d) => DAY_NAMES[d]).join('، ')}` : ''} — تتغير من الإعدادات ← قواعد العمل</div>
      {!empId ? (
        shown.length === 0 ? <div className="card"><Empty icon={<Users />} title="لا يوجد موظفون" /></div> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الموظف</th><th className="n">حاضر</th><th className="n">متأخر</th><th className="n">غائب</th><th className="n">أجازات (من {rules.leaveDays})</th><th className="n">بدون تسجيل</th><th className="n">إجمالي الساعات</th><th className="n">إجمالي التأخير</th><th className="n">انصراف مبكر</th><th className="n">متوسط الحضور</th><th /></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.e.id} className="click" onClick={() => setEmpId(s.e.id)}>
                    <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={s.e.name} />{s.e.name}</span></td>
                    <td data-label="حاضر" className="n green">{s.present}</td>
                    <td data-label="متأخر" className="n orange">{s.late}</td>
                    <td data-label="غائب" className="n red">{s.absent}</td>
                    <td data-label="أجازات" className={`n ${s.leave > rules.leaveDays ? 'red bold' : ''}`}>{s.leave}{s.leave > rules.leaveDays && <div className="small">زيادة {s.leave - rules.leaveDays}</div>}</td>
                    <td data-label="بدون تسجيل" className="n muted">{s.missing}</td>
                    <td data-label="إجمالي الساعات" className="n bold">{fmtHours(s.minutes)}</td>
                    <td data-label="إجمالي التأخير" className={`n ${s.lateMin ? 'orange bold' : ''}`}>{fmtHours(s.lateMin)}</td>
                    <td data-label="انصراف مبكر" className={`n ${s.earlyMin ? 'orange bold' : ''}`}>{fmtHours(s.earlyMin)}</td>
                    <td data-label="متوسط الحضور" className="n">{s.avgIn ? fmtTime(s.avgIn) : '—'}</td>
                    <td data-label="" className="lp-act-cell"><RowActions openLabel="تفاصيل الأيام" onOpen={() => setEmpId(s.e.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {one && (
            <TotalCards items={[
              { label: 'أيام حضور', value: one.present + one.late, tone: 'green' },
              { label: one.lateMin ? `أيام تأخير (إجمالي ${fmtHours(one.lateMin)})` : 'أيام تأخير', value: one.late, tone: 'orange' },
              { label: 'غياب', value: one.absent, tone: 'red' },
              { label: `أجازات (من ${rules.leaveDays})${one.leave > rules.leaveDays ? ` — زيادة ${one.leave - rules.leaveDays}` : ''}`, value: one.leave, tone: one.leave > rules.leaveDays ? 'red' : 'purple' },
              { label: 'إجمالي ساعات العمل', value: fmtHours(one.minutes), tone: 'blue' },
            ]} />
          )}
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>التاريخ</th><th>اليوم</th><th>الحالة</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>التأخير</th><th>انصراف مبكر</th></tr></thead>
              <tbody>
                {days.map((d) => {
                  const r = byDay.get(d);
                  const st = r ? STATUS_LABEL[r.status] : null;
                  return (
                    <tr key={d}>
                      <td data-label="التاريخ" className="num">{d}</td>
                      <td data-label="اليوم">{DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()]}</td>
                      <td data-label="الحالة">{st ? <span className={`badge ${st.tone}`}>{st.label}</span> : rules.isOff(d) ? <span className="badge blue">أجازة أسبوعية</span> : <span className="badge gray">لم يُسجَّل</span>}</td>
                      <td data-label="الحضور" className="num">{fmtTime(r?.check_in)}</td>
                      <td data-label="الانصراف" className="num">{fmtTime(r?.check_out)}</td>
                      <td data-label="ساعات العمل" className="num bold">{fmtHours(minutesOf(r))}</td>
                      <td data-label="التأخير" className={`num ${rules.lateMinutes(r?.check_in) ? 'orange bold' : 'muted'}`}>{fmtHours(rules.lateMinutes(r?.check_in))}</td>
                      <td data-label="انصراف مبكر" className={`num ${rules.earlyMinutes(r?.check_out) ? 'orange bold' : 'muted'}`}>{fmtHours(rules.earlyMinutes(r?.check_out))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
  // فلتر الإدارة للعرض بس — الاعتماد بيكون لكل الموظفين في مسير واحد للشهر
  const [dept, setDept] = useDeptFilter();
  const { depts, match } = useDeptMatcher(dept);
  const shownIds = new Set(employees.filter(match).map((e) => e.id));
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const { from, to } = monthRange(ym);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [box, setBox] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const rules = useWorkRules();
  // أيام الخصم = الغياب + الأجازات الزيادة عن المسموح في الشهر
  const absences = useLiveQuery(async () => {
    const absent = new Map<string, number>();
    const leave = new Map<string, number>();
    for (const r of await db.attendance.where('date').between(from, to, true, true).toArray()) {
      if (r.status === 'absent') absent.set(r.employee_id, (absent.get(r.employee_id) ?? 0) + 1);
      if (r.status === 'leave') leave.set(r.employee_id, (leave.get(r.employee_id) ?? 0) + 1);
    }
    return { absent, leave };
  }, [from, to]) ?? { absent: new Map<string, number>(), leave: new Map<string, number>() };
  const runs = useLiveQuery(async () => (await db.documents.where('doc_type').equals('payroll').toArray()).sort((a, b) => String(b.data?.period_from ?? b.date).localeCompare(String(a.data?.period_from ?? a.date))), []) ?? [];
  const done = runs.find((d) => d.status !== 'cancelled' && (d.data?.period_from ?? d.period_from) === from);

  const rows: (Row & { extraLeave: number; name: string; job: string; balance: number; net: number })[] = employees
    .filter((e) => e.active !== false)
    .map((e) => {
      const extraLeave = Math.max(0, (absences.leave.get(e.id) ?? 0) - rules.leaveDays);
      const days = (absences.absent.get(e.id) ?? 0) + extraLeave;
      const base: Row = { employee_id: e.id, salary: e.salary ?? 0, absent_days: days, absence_deduction: Math.round(((e.salary ?? 0) / 30) * days), bonus: 0, other_deduction: 0, advance_deduction: 0 };
      const r = { ...base, ...(edits[e.id] ?? {}) } as Row;
      return { ...r, extraLeave, name: e.name, job: e.job_title ?? '', balance: Math.max(0, e.advance_balance ?? 0), net: r.salary + r.bonus - r.absence_deduction - r.other_deduction - r.advance_deduction };
    });
  const set = (id: string, k: keyof Row, v: number) => setEdits((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [k]: v } }));
  const sum = (k: 'salary' | 'bonus' | 'absence_deduction' | 'other_deduction' | 'advance_deduction' | 'net', list = rows) => list.reduce((s, r) => s + r[k], 0);
  const shown = rows.filter((r) => shownIds.has(r.employee_id));
  const deptName = dept === '-' ? 'من غير إدارة' : depts.find((d) => d.id === dept)?.name;
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
        sub={`الصافي = الراتب + المكافأة − الغياب − الجزاءات − خصم السلفة · الأجازات اللي تزيد عن ${rules.leaveDays} أيام في الشهر تتخصم زي الغياب`}
        actions={<>
          <DeptSelect value={dept} onChange={setDept} depts={depts} />
          <input type="month" className="input" style={{ width: 180 }} value={ym} onChange={(e) => e.target.value && (setYm(e.target.value), setEdits({}))} />
        </>}
      />
      {err && <div style={{ marginBottom: 12 }}><Banner kind="err">{err}</Banner></div>}
      {done ? (
        <Banner kind="ok">رواتب {monthLabel(from)} معتمدة في المسير {done.number ?? done.local_number} بإجمالي {formatMoney(done.total)}. اختر شهرًا آخر لإعداد مسير جديد.</Banner>
      ) : rows.length === 0 ? (
        <div className="card"><Empty icon={<Wallet />} title="لا يوجد موظفون نشطون" /></div>
      ) : (
        <>
          {deptName && <div style={{ marginBottom: 12 }}><Banner kind="info">بتعرض موظفين «{deptName}» بس. الاعتماد بيصرف رواتب كل الموظفين ({rows.length}) في مسير واحد للشهر.</Banner></div>}
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الموظف</th><th className="n">الراتب</th><th className="n">أيام الغياب</th><th className="n">خصم الغياب</th><th className="n">مكافأة</th><th className="n">جزاءات</th><th className="n">خصم سلفة</th><th className="n">الصافي</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.employee_id}>
                    <td data-label="الموظف" className="bold"><span className="lp-name"><Avatar name={r.name} />{r.name}</span>{r.job && <div className="muted small">{r.job}</div>}</td>
                    <td data-label="الراتب" className="n">{formatMoney(r.salary)}</td>
                    <td data-label="أيام الغياب" className="n">{r.absent_days}{r.extraLeave > 0 && <div className="small orange">منها {r.extraLeave} أجازة زيادة</div>}</td>
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
              <tfoot><tr><td>{deptName ? `إجمالي ${deptName}` : 'الإجمالي'} ({shown.length} موظف)</td><td className="n">{formatMoney(sum('salary', shown))}</td><td /><td className="n">{formatMoney(sum('absence_deduction', shown))}</td><td className="n">{formatMoney(sum('bonus', shown))}</td><td className="n">{formatMoney(sum('other_deduction', shown))}</td><td className="n">{formatMoney(sum('advance_deduction', shown))}</td><td className="n">{formatMoney(sum('net', shown))}</td></tr></tfoot>
            </table>
          </div>
          {can('employees.create') && (
            <div className="pay-bar">
              <div className="si-grand pay-grand"><span>صافي رواتب {monthLabel(from)}{deptName ? ` — كل الإدارات (${rows.length} موظف)` : ''}</span><b className="num">{formatMoney(sum('net'))}</b></div>
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
