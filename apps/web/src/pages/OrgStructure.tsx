import { uuid } from '@erp/shared';
import { Briefcase, Building2, ChevronDown, Network, Plus, Users } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/Layout';
import { ActiveBadge, Avatar, InlineTabs, PageTabs, RowActions, TotalCards } from '../components/ListParts';
import { Banner, Empty, Field, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { usePerm, useSettings } from '../lib/hooks';
import { deptPath, deptTree, useDepartments, useJobTitles, withChildren } from '../lib/org';
import { EMPLOYEE_TABS, EmployeeEditor } from './Employees';
import '../org.css';

type View = 'chart' | 'departments' | 'titles';

export function OrgStructurePage() {
  const can = usePerm();
  const s = useSettings();
  const depts = useDepartments();
  const titles = useJobTitles();
  const employees = useLiveQuery(async () => (await db.employees.toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')), []) ?? [];
  const [view, setView] = useState<View>('chart');
  const [mode, setMode] = useState<'dept' | 'manager'>('dept');
  const [editDept, setEditDept] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState<any | null>(null);
  const [editEmp, setEditEmp] = useState<any | null>(null);
  const manage = can('employees.manage');
  const active = employees.filter((e) => e.active !== false);
  const titleName = useMemo(() => new Map(titles.map((t) => [t.id, t.name])), [titles]);
  const jobOf = (e: any) => (e.job_title_id && titleName.get(e.job_title_id)) || e.job_title || '';
  const openEmp = manage ? (e: any) => setEditEmp(e) : undefined;

  return (
    <div className="page">
      <PageTabs tabs={EMPLOYEE_TABS} />
      <PageHeader
        title="الهيكل التنظيمي"
        sub="الإدارات والأقسام، مين مدير مين، وقائمة الوظائف"
        actions={manage && <>
          {view !== 'titles' && <button className="btn primary" onClick={() => setEditDept({})}><Plus /> إدارة جديدة</button>}
          {view === 'titles' && <button className="btn primary" onClick={() => setEditTitle({})}><Plus /> وظيفة جديدة</button>}
        </>}
      />
      <TotalCards items={[
        { label: 'الإدارات والأقسام', value: depts.filter((d) => d.active !== false).length, tone: 'blue' },
        { label: 'الوظائف', value: titles.filter((t) => t.active !== false).length, tone: 'purple' },
        { label: 'موظفين نشطين', value: active.length, tone: 'green' },
        { label: 'من غير إدارة', value: active.filter((e) => !e.department_id).length, tone: 'orange' },
      ]} />
      <div className="org-bar">
        <InlineTabs<View> value={view} onChange={setView} options={[
          { value: 'chart', label: <><Network size={16} /> شجرة الهيكل</> },
          { value: 'departments', label: <><Building2 size={16} /> الإدارات</> },
          { value: 'titles', label: <><Briefcase size={16} /> الوظائف</> },
        ]} />
        {view === 'chart' && (
          <div className="segmented" role="tablist" aria-label="طريقة عرض الشجرة">
            <button type="button" role="tab" aria-selected={mode === 'dept'} className={mode === 'dept' ? 'on' : ''} onClick={() => setMode('dept')}>حسب الإدارات</button>
            <button type="button" role="tab" aria-selected={mode === 'manager'} className={mode === 'manager' ? 'on' : ''} onClick={() => setMode('manager')}>حسب المدير المباشر</button>
          </div>
        )}
      </div>

      {view === 'chart' && (
        <>
          {employees.length === 0 && depts.length === 0 ? (
            <div className="card"><Empty icon={<Network />} title="لسه مفيش هيكل">{manage && <button className="btn primary" onClick={() => setEditDept({})}><Plus /> أضف أول إدارة</button>}</Empty></div>
          ) : mode === 'dept' ? (
            <DeptChart company={s.company_name || 'الشركة'} depts={depts.filter((d) => d.active !== false)} employees={active} jobOf={jobOf} onEmp={openEmp} onDept={manage ? setEditDept : undefined} />
          ) : (
            <ManagerChart company={s.company_name || 'الشركة'} employees={active} depts={depts} jobOf={jobOf} onEmp={openEmp} />
          )}
        </>
      )}

      {view === 'departments' && (
        depts.length === 0 ? (
          <div className="card"><Empty icon={<Building2 />} title="لا توجد إدارات بعد">{manage && <button className="btn primary" onClick={() => setEditDept({})}><Plus /> أضف أول إدارة</button>}</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الإدارة</th><th>تابعة لـ</th><th>المدير</th><th className="n">الموظفين</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {deptTree(depts).map(({ d, depth }) => {
                  const mgr = employees.find((e) => e.id === d.manager_id);
                  const inside = withChildren(depts, d.id);
                  const n = active.filter((e) => inside.has(e.department_id)).length;
                  return (
                    <tr key={d.id} className={manage ? 'click' : ''} onClick={() => manage && setEditDept(d)}>
                      <td data-label="الإدارة" className="bold"><span className="lp-name" style={{ paddingInlineStart: depth * 22 }}>{depth > 0 && <span className="muted org-elbow">└</span>}<span className="org-dot"><Building2 /></span>{d.name}</span></td>
                      <td data-label="تابعة لـ" className="muted">{d.parent_id ? deptPath(depts, d.parent_id) : 'رئيسية'}</td>
                      <td data-label="المدير">{mgr ? <span className="lp-name"><Avatar name={mgr.name} />{mgr.name}</span> : <span className="muted">—</span>}</td>
                      <td data-label="الموظفين" className="n bold">{n}</td>
                      <td data-label="الحالة"><ActiveBadge active={d.active !== false} /></td>
                      <td data-label="" className="lp-act-cell"><RowActions onEdit={manage ? () => setEditDept(d) : undefined}><SyncBadge sync={d._sync} error={d._error} /></RowActions></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {view === 'titles' && (
        titles.length === 0 ? (
          <div className="card"><Empty icon={<Briefcase />} title="لا توجد وظائف بعد">{manage && <button className="btn primary" onClick={() => setEditTitle({})}><Plus /> أضف أول وظيفة</button>}</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الوظيفة</th><th className="n">الموظفين</th><th>ملاحظات</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {titles.map((t) => (
                  <tr key={t.id} className={manage ? 'click' : ''} onClick={() => manage && setEditTitle(t)}>
                    <td data-label="الوظيفة" className="bold"><span className="lp-name"><span className="org-dot purple"><Briefcase /></span>{t.name}</span></td>
                    <td data-label="الموظفين" className="n bold">{active.filter((e) => e.job_title_id === t.id).length}</td>
                    <td data-label="ملاحظات" className="muted">{t.notes || '—'}</td>
                    <td data-label="الحالة"><ActiveBadge active={t.active !== false} /></td>
                    <td data-label="" className="lp-act-cell"><RowActions onEdit={manage ? () => setEditTitle(t) : undefined}><SyncBadge sync={t._sync} error={t._error} /></RowActions></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {editDept && <DeptEditor dept={editDept.id ? editDept : null} depts={depts} employees={active} onClose={() => setEditDept(null)} />}
      {editTitle && <TitleEditor title={editTitle.id ? editTitle : null} titles={titles} onClose={() => setEditTitle(null)} />}
      {editEmp && <EmployeeEditor emp={editEmp} onClose={() => setEditEmp(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ الشجرة حسب الإدارات
function DeptChart({ company, depts, employees, jobOf, onEmp, onDept }: { company: string; depts: any[]; employees: any[]; jobOf: (e: any) => string; onEmp?: (e: any) => void; onDept?: (d: any) => void }) {
  const ids = new Set(depts.map((d) => d.id));
  const roots = depts.filter((d) => !d.parent_id || !ids.has(d.parent_id));
  const loose = employees.filter((e) => !e.department_id || !ids.has(e.department_id));
  const render = (d: any, seen: Set<string>): ReactElement | null => {
    if (seen.has(d.id)) return null;
    const next = new Set(seen).add(d.id);
    const kids = depts.filter((x) => x.parent_id === d.id);
    return (
      <li key={d.id}>
        <DeptNode d={d} members={employees.filter((e) => e.department_id === d.id)} manager={employees.find((e) => e.id === d.manager_id)} jobOf={jobOf} onEmp={onEmp} onDept={onDept} />
        {kids.length > 0 && <ul>{kids.map((k) => render(k, next))}</ul>}
      </li>
    );
  };
  return (
    <div className="org-scroll">
      <ul className="org-tree">
        <li>
          <div className="org-node org-root"><span className="org-ico"><Building2 /></span><b>{company}</b><span className="small">{employees.length} موظف</span></div>
          {(roots.length > 0 || loose.length > 0) && (
            <ul>
              {roots.map((d) => render(d, new Set()))}
              {loose.length > 0 && (
                <li><DeptNode d={{ id: '-', name: 'من غير إدارة' }} members={loose} jobOf={jobOf} onEmp={onEmp} muted /></li>
              )}
            </ul>
          )}
        </li>
      </ul>
    </div>
  );
}

function DeptNode({ d, members, manager, jobOf, onEmp, onDept, muted }: { d: any; members: any[]; manager?: any; jobOf: (e: any) => string; onEmp?: (e: any) => void; onDept?: (d: any) => void; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const others = members.filter((e) => e.id !== manager?.id);
  return (
    <div className={`org-node org-dept ${muted ? 'muted-node' : ''}`}>
      <div className="org-dept-h">
        <span className="org-ico"><Building2 /></span>
        <b title={d.notes || undefined}>{d.name}</b>
        {onDept && <button type="button" className="org-mini" onClick={() => onDept(d)} aria-label={`تعديل ${d.name}`}>تعديل</button>}
      </div>
      {manager ? (
        <button type="button" className="org-person mgr" onClick={() => onEmp?.(manager)} disabled={!onEmp}>
          <Avatar name={manager.name} /><span><b>{manager.name}</b><small>مدير الإدارة{jobOf(manager) ? ` · ${jobOf(manager)}` : ''}</small></span>
        </button>
      ) : !muted && <div className="org-nomgr">لسه مفيش مدير</div>}
      {others.length > 0 ? (
        <>
          <button type="button" className="org-count" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <Users size={15} /> {others.length} موظف <ChevronDown size={15} className={open ? 'rot' : ''} />
          </button>
          {open && (
            <div className="org-members">
              {others.map((e) => (
                <button key={e.id} type="button" className="org-person" onClick={() => onEmp?.(e)} disabled={!onEmp}>
                  <Avatar name={e.name} /><span><b>{e.name}</b>{jobOf(e) && <small>{jobOf(e)}</small>}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : !manager && <div className="org-nomgr">مفيش موظفين</div>}
    </div>
  );
}

// ------------------------------------------------------------------ الشجرة حسب المدير المباشر
function ManagerChart({ company, employees, depts, jobOf, onEmp }: { company: string; employees: any[]; depts: any[]; jobOf: (e: any) => string; onEmp?: (e: any) => void }) {
  const ids = new Set(employees.map((e) => e.id));
  const roots = employees.filter((e) => !e.manager_id || !ids.has(e.manager_id));
  const render = (e: any, seen: Set<string>): ReactElement | null => {
    if (seen.has(e.id)) return null;
    const next = new Set(seen).add(e.id);
    const team = employees.filter((x) => x.manager_id === e.id);
    return (
      <li key={e.id}>
        <button type="button" className="org-node org-emp" onClick={() => onEmp?.(e)} disabled={!onEmp}>
          <Avatar name={e.name} />
          <span><b>{e.name}</b><small>{[jobOf(e), depts.find((d) => d.id === e.department_id)?.name].filter(Boolean).join(' · ') || '—'}</small></span>
          {team.length > 0 && <span className="org-team">{team.length}</span>}
        </button>
        {team.length > 0 && <ul>{team.map((x) => render(x, next))}</ul>}
      </li>
    );
  };
  return (
    <div className="org-scroll">
      <ul className="org-tree">
        <li>
          <div className="org-node org-root"><span className="org-ico"><Building2 /></span><b>{company}</b><span className="small">{employees.length} موظف</span></div>
          {roots.length > 0 && <ul>{roots.map((e) => render(e, new Set()))}</ul>}
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ تعديل إدارة
function DeptEditor({ dept, depts, employees, onClose }: { dept: any | null; depts: any[]; employees: any[]; onClose: () => void }) {
  const ui = useUi();
  const [f, setF] = useState<any>(() => ({ name: dept?.name ?? '', parent_id: dept?.parent_id ?? '', manager_id: dept?.manager_id ?? '', notes: dept?.notes ?? '', sort: dept?.sort ?? 0, active: dept?.active ?? true }));
  const [err, setErr] = useState<string | null>(null);
  // الإدارة ما تتحطش تحت نفسها أو تحت قسم من أقسامها
  const blocked = dept ? withChildren(depts, dept.id) : new Set<string>();
  const parents = deptTree(depts).filter(({ d }) => !blocked.has(d.id) && (d.active !== false || d.id === f.parent_id));
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return setErr('اسم الإدارة مطلوب');
    if (dept && dept.active !== false && !f.active) {
      const n = employees.filter((e) => e.department_id === dept.id).length;
      if (n) return setErr(`لا يمكن إيقاف الإدارة وفيها ${n} موظف نشط — انقلهم لإدارة تانية الأول`);
      if (depts.some((d) => d.parent_id === dept.id && d.active !== false)) return setErr('لا يمكن إيقاف الإدارة وتحتها أقسام نشطة');
    }
    try {
      await saveMaster('department', dept?.id ?? uuid(), { ...f, name: f.name.trim(), parent_id: f.parent_id || null, manager_id: f.manager_id || null, notes: f.notes || null }, dept);
      ui.toast(dept ? 'تم تعديل الإدارة' : 'تمت إضافة الإدارة');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet title={dept ? `تعديل: ${dept.name}` : 'إدارة جديدة'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={() => void save()}>حفظ</button></>}>
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الإدارة أو القسم" required><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: المبيعات، المخازن، الحسابات" /></Field>
        <Field label="تابعة لإدارة" hint="سيبها «رئيسية» لو الإدارة مش جوه إدارة تانية">
          <select className="select" value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
            <option value="">رئيسية</option>
            {parents.map(({ d, depth }) => <option key={d.id} value={d.id}>{'  '.repeat(depth)}{depth ? '└ ' : ''}{d.name}</option>)}
          </select>
        </Field>
        <Field label="مدير الإدارة">
          <select className="select" value={f.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
            <option value="">— من غير مدير —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="row"><span style={{ flex: 1 }}>إدارة نشطة</span><Switch checked={f.active} onChange={(v) => set('active', v)} /></div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ تعديل وظيفة
function TitleEditor({ title, titles, onClose }: { title: any | null; titles: any[]; onClose: () => void }) {
  const ui = useUi();
  const [f, setF] = useState<any>(() => ({ name: title?.name ?? '', notes: title?.notes ?? '', active: title?.active ?? true }));
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const name = f.name.trim();
    if (!name) return setErr('اسم الوظيفة مطلوب');
    if (titles.some((t) => t.id !== title?.id && String(t.name).trim().toLowerCase() === name.toLowerCase())) return setErr('الوظيفة دي موجودة بالفعل في القائمة');
    try {
      await saveMaster('job_title', title?.id ?? uuid(), { name, notes: f.notes || null, active: f.active }, title);
      ui.toast(title ? 'تم تعديل الوظيفة' : 'تمت إضافة الوظيفة');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet title={title ? `تعديل: ${title.name}` : 'وظيفة جديدة'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={() => void save()}>حفظ</button></>}>
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الوظيفة" required hint={title ? 'تغيير الاسم بيتغير عند كل الموظفين اللي على الوظيفة دي' : undefined}><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: كاشير، أمين مخزن، محاسب" /></Field>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="row"><span style={{ flex: 1 }}>وظيفة نشطة</span><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
    </Sheet>
  );
}
