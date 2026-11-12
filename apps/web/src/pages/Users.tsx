import { BUILTIN_ROLE_HOME, canUseWorkspace, inferRoleHome, PERMISSION_GROUPS, uuid, WORKSPACES } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Banner, Field, Sheet, Switch, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { parseRoleHomes } from '../lib/home';
import { useSession, useSettings } from '../lib/hooks';
import { syncNow } from '../lib/sync';

/** إدارة المستخدمين والأدوار تتم مباشرة على الخادم (تحتاج اتصالًا) لأنها تمس الأمان */
export function UsersPage() {
  const ui = useUi();
  const { session } = useSession();
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const roles = useLiveQuery(() => db.roles.toArray(), []) ?? [];
  const [u, setU] = useState<any | null>(null);
  const [r, setR] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const roleName = new Map(roles.map((x) => [x.id, x.name]));
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? [];
  const cashboxes = useLiveQuery(() => db.cashboxes.toArray(), []) ?? [];

  const saveUser = async () => {
    setErr(null);
    try {
      const res = await api<{ id: string }>('/api/admin/users', {
        body: {
          id: u.id, username: u.username, full_name: u.full_name, role_id: u.role_id, active: u.active, password: u.password || undefined,
          warehouse_ids: u.role_id === 'role-admin' ? null : u.warehouse_ids ?? null,
          cashbox_ids: u.role_id === 'role-admin' ? null : u.cashbox_ids ?? null,
        },
      });
      // خزنة مستقلة للموظف الجديد باسمه ومسؤوليته
      if (!u.id && u.own_cashbox && res?.id) {
        await saveMaster('cashbox', uuid(), { name: `خزنة ${u.full_name.trim()}`, kind: 'cash', user_id: res.id, active: true, fee_bp: 0, fee_min: 0, fee_fixed: 0 }, null);
      }
      ui.toast(!u.id && u.own_cashbox ? 'تم إنشاء المستخدم وخزنته' : 'تم الحفظ');
      setU(null);
      void syncNow();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const saveRole = async () => {
    setErr(null);
    try {
      const limits: any = {};
      if (Number(r.max_pct) > 0) limits.max_discount_bp = Math.round(Number(r.max_pct) * 100);
      if (Number(r.max_amount) > 0) limits.max_discount_amount = Math.round(Number(r.max_amount) * 100);
      await api('/api/admin/roles', { body: { id: r.id, name: r.name, permissions: r.permissions, limits } });
      ui.toast('تم الحفظ');
      setR(null);
      void syncNow();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="page narrow">
      <PageHeader title="المستخدمون والصلاحيات" sub="تحتاج هذه الشاشة اتصالًا بالخادم للحفظ." />
      <div className="row"><div className="section-title" style={{ flex: 1, margin: 0 }}>المستخدمون</div><button className="btn sm primary" onClick={() => { setErr(null); setU({ username: '', full_name: '', role_id: 'role-cashier', active: true, password: '', own_cashbox: true }); }}><Plus /> مستخدم</button></div>
      <div className="list" style={{ marginTop: 10 }}>
        {users.map((x) => (
          <div key={x.id} className="list-row tappable" onClick={() => { setErr(null); setU({ ...x, password: '' }); }}>
            <div className="title">{x.full_name}<div className="sub">{x.username} · {roleName.get(x.role_id)}</div></div>
            {!x.active && <span className="badge">موقوف</span>}
            {x.id === session.user.id && <span className="badge blue">أنت</span>}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 26 }}><div className="section-title" style={{ flex: 1, margin: 0 }}>الأدوار</div><button className="btn sm" onClick={() => { setErr(null); setR({ name: '', permissions: [] }); }}><Plus /> دور</button></div>
      <div className="list" style={{ marginTop: 10 }}>
        {roles.map((x) => (
          <div key={x.id} className="list-row tappable" onClick={() => { setErr(null); x.id !== 'role-admin' && setR({ ...x }); }}>
            <div className="title">{x.name}<div className="sub">{x.permissions.includes('*') ? 'كل الصلاحيات' : `${x.permissions.length} صلاحية`}</div></div>
          </div>
        ))}
      </div>

      <RoleHomes roles={roles} />

      {u && (
        <Sheet title={u.id ? 'تعديل مستخدم' : 'مستخدم جديد'} onClose={() => setU(null)} footer={<><button className="btn" onClick={() => setU(null)}>إلغاء</button><button className="btn primary" onClick={saveUser}>حفظ</button></>}>
          <div className="stack">
            {err && <Banner kind="err">{err}</Banner>}
            <Field label="الاسم الكامل"><input className="input" value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} /></Field>
            <Field label="اسم المستخدم"><input className="input" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} autoComplete="off" /></Field>
            <Field label={u.id ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'} hint="6 أحرف على الأقل">
              <input className="input" type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label="الدور">
              <select className="select" value={u.role_id} onChange={(e) => setU({ ...u, role_id: e.target.value })}>
                {roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <div className="row"><Switch checked={u.active} onChange={(v) => setU({ ...u, active: v })} /> {u.active ? 'نشط' : 'موقوف'}</div>
            {!u.id && <div className="row"><Switch checked={!!u.own_cashbox} onChange={(v) => setU({ ...u, own_cashbox: v })} /> إنشاء خزنة نقدية مستقلة باسمه ومسؤوليته</div>}
            {u.id && (() => {
              const own = cashboxes.filter((c) => c.user_id === u.id);
              return <div className="footnote">{own.length ? `خزنته: ${own.map((c) => c.name).join('، ')}` : 'ليس مسؤولًا عن أي خزنة — حدّد المسؤول من شاشة الخزائن.'}</div>;
            })()}
            {u.role_id === 'role-admin' ? (
              <div className="footnote">مدير النظام يعمل على كل المخازن والخزائن (بما فيها أي خزينة أو بنك يُضاف لاحقًا).</div>
            ) : (
              <>
                <ScopePicker label="المخازن المسموحة" all={warehouses} value={u.warehouse_ids ?? null} onChange={(v) => setU({ ...u, warehouse_ids: v })} />
                <ScopePicker label="الخزائن وطرق الدفع المسموحة" all={cashboxes} value={u.cashbox_ids ?? null} onChange={(v) => setU({ ...u, cashbox_ids: v })} />
                <div className="footnote">«الكل» يشمل أي مخزن أو خزينة تُضاف لاحقًا. عند التحديد يجب إضافة الجديد هنا يدويًا.</div>
              </>
            )}
          </div>
        </Sheet>
      )}
      {r && (
        <Sheet title={r.id ? 'تعديل دور' : 'دور جديد'} wide onClose={() => setR(null)} footer={<><button className="btn" onClick={() => setR(null)}>إلغاء</button><button className="btn primary" onClick={saveRole}>حفظ</button></>}>
          <div className="stack">
            {err && <Banner kind="err">{err}</Banner>}
            <Field label="اسم الدور"><input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="أقصى نسبة خصم على الفاتورة %" hint="0 = بدون حد"><input className="input num" inputMode="decimal" value={r.max_pct ?? (r.limits?.max_discount_bp ? r.limits.max_discount_bp / 100 : 0)} onChange={(e) => setR({ ...r, max_pct: e.target.value })} /></Field>
              <Field label="أقصى قيمة خصم (ج.م)" hint="0 = بدون حد"><input className="input num" inputMode="decimal" value={r.max_amount ?? (r.limits?.max_discount_amount ? r.limits.max_discount_amount / 100 : 0)} onChange={(e) => setR({ ...r, max_amount: e.target.value })} /></Field>
            </div>
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.module}>
                <div className="group-header" style={{ paddingInlineStart: 4 }}>{g.label}</div>
                <div className="list" style={{ background: 'var(--bg-elevated)' }}>
                  {g.actions.map((a) => (
                    <div key={a.key} className="list-row">
                      <div className="title">{a.label}</div>
                      <Switch
                        checked={r.permissions.includes(a.key)}
                        onChange={(v) => setR({ ...r, permissions: v ? [...r.permissions, a.key] : r.permissions.filter((p: string) => p !== a.key) })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ScopePicker({ label, all, value, onChange }: { label: string; all: any[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  const restricted = value !== null;
  return (
    <div>
      <div className="row">
        <div className="bold" style={{ flex: 1 }}>{label}</div>
        <span className="small muted">{restricted ? 'محددة' : 'الكل'}</span>
        <Switch checked={restricted} onChange={(v) => onChange(v ? [] : null)} />
      </div>
      {restricted && (
        <div className="list" style={{ marginTop: 8, background: 'var(--bg-elevated)' }}>
          {all.map((x) => (
            <div key={x.id} className="list-row">
              <div className="title">{x.name}</div>
              <Switch checked={value!.includes(x.id)} onChange={(v) => onChange(v ? [...value!, x.id] : value!.filter((y) => y !== x.id))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** صفحة البداية لكل دور: المدير يختار من المساحات التي يسمح بها الدور نفسه */
function RoleHomes({ roles }: { roles: any[] }) {
  const ui = useUi();
  const settings = useSettings();
  const map = parseRoleHomes(settings.role_home_pages);
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (roleId: string, workspace: string | null) => {
    setBusy(roleId);
    try {
      await api('/api/admin/role-home', { body: { role_id: roleId, workspace } });
      await syncNow();
      ui.toast('تم حفظ صفحة البداية للدور');
    } catch (e) {
      ui.toast((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="section-title" style={{ marginTop: 26 }}>صفحة البداية لكل دور</div>
      <div className="list">
        {roles.map((r) => {
          const perms: string[] = r.permissions ?? [];
          const options = WORKSPACES.filter((w) => canUseWorkspace(w.id, perms));
          const builtin = WORKSPACES.find((w) => w.id === (BUILTIN_ROLE_HOME[r.id] ?? inferRoleHome(perms)));
          const fallbackLabel = builtin && canUseWorkspace(builtin.id, perms) ? builtin.label : options[0]?.label;
          return (
            <div key={r.id} className="list-row">
              <div className="title">{r.name}<div className="sub">يفتح عليها مستخدمو الدور ما لم يختر المستخدم صفحة أخرى</div></div>
              <select
                className="select"
                style={{ width: 220 }}
                aria-label={`صفحة البداية لدور ${r.name}`}
                disabled={busy === r.id}
                value={map[r.id] && options.some((o) => o.id === map[r.id]) ? map[r.id] : ''}
                onChange={(e) => void save(r.id, e.target.value || null)}
              >
                <option value="">تلقائي ({fallbackLabel})</option>
                {options.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <div className="footnote" style={{ marginTop: 6 }}>صفحة البداية لا تمنح أي صلاحية؛ تظهر فقط المساحات التي يملك الدور صلاحية فتحها.</div>
    </>
  );
}
