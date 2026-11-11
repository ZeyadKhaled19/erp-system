import { PERMISSION_GROUPS } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Banner, Field, Sheet, Switch, useUi } from '../components/ui';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { useSession } from '../lib/hooks';
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
      await api('/api/admin/users', {
        body: { id: u.id, username: u.username, full_name: u.full_name, role_id: u.role_id, active: u.active, password: u.password || undefined, warehouse_ids: u.warehouse_ids ?? null, cashbox_ids: u.cashbox_ids ?? null },
      });
      ui.toast('تم الحفظ');
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
      <div className="row"><div className="section-title" style={{ flex: 1, margin: 0 }}>المستخدمون</div><button className="btn sm primary" onClick={() => { setErr(null); setU({ username: '', full_name: '', role_id: 'role-cashier', active: true, password: '' }); }}><Plus /> مستخدم</button></div>
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
            <ScopePicker label="المخازن المسموحة" all={warehouses} value={u.warehouse_ids ?? null} onChange={(v) => setU({ ...u, warehouse_ids: v })} />
            <ScopePicker label="الخزائن المسموحة" all={cashboxes} value={u.cashbox_ids ?? null} onChange={(v) => setU({ ...u, cashbox_ids: v })} />
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
