import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Field, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';

export function WarehousesPage() {
  const can = usePerm();
  const ui = useUi();
  const whs = useLiveQuery(() => db.warehouses.orderBy('code').toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const [edit, setEdit] = useState<{ entity: 'warehouse' | 'category'; row: any } | null>(null);
  const [f, setF] = useState<any>({});
  const open = (entity: 'warehouse' | 'category', row: any) => {
    setEdit({ entity, row });
    setF({ code: row.code ?? '', name: row.name ?? '', active: row.active ?? true });
  };
  const save = async () => {
    if (!edit) return;
    const data = edit.entity === 'warehouse' ? { code: f.code.trim(), name: f.name.trim(), active: f.active } : { name: f.name.trim(), active: f.active };
    if (!data.name || (edit.entity === 'warehouse' && !f.code.trim())) return ui.toast('أكمل البيانات', 'err');
    const list = edit.entity === 'warehouse' ? whs : cats;
    if (list.some((x) => x.id !== edit.row.id && (x.name === data.name || (edit.entity === 'warehouse' && x.code === f.code.trim())))) return ui.toast('الاسم أو الكود مستخدم', 'err');
    await saveMaster(edit.entity, edit.row.id ?? uuid(), data, edit.row.id ? edit.row : null);
    ui.toast('تم الحفظ');
    setEdit(null);
  };

  return (
    <div className="page narrow">
      <PageHeader title="المخازن والتصنيفات" />
      <div className="row" style={{ marginTop: 10 }}>
        <div className="section-title" style={{ flex: 1, margin: 0 }}>المخازن</div>
        {can('items.create') && <button className="btn sm" onClick={() => open('warehouse', {})}><Plus /> مخزن</button>}
      </div>
      <div className="list" style={{ marginTop: 10 }}>
        {whs.map((w) => (
          <div key={w.id} className="list-row tappable" onClick={() => can('items.edit') && open('warehouse', w)}>
            <span className="num muted" style={{ width: 40 }}>{w.code}</span>
            <div className="title">{w.name}</div>
            {w.active === false && <span className="badge">موقوف</span>}
            <SyncBadge sync={w._sync} error={w._error} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 26 }}>
        <div className="section-title" style={{ flex: 1, margin: 0 }}>تصنيفات الأصناف</div>
        {can('items.create') && <button className="btn sm" onClick={() => open('category', {})}><Plus /> تصنيف</button>}
      </div>
      <div className="list" style={{ marginTop: 10 }}>
        {cats.map((c) => (
          <div key={c.id} className="list-row tappable" onClick={() => can('items.edit') && open('category', c)}>
            <div className="title">{c.name}</div>
            {c.active === false && <span className="badge">موقوف</span>}
            <SyncBadge sync={c._sync} error={c._error} />
          </div>
        ))}
      </div>
      {edit && (
        <Sheet title={edit.entity === 'warehouse' ? 'مخزن' : 'تصنيف'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>إلغاء</button><button className="btn primary" onClick={save}>حفظ</button></>}>
          <div className="stack">
            {edit.entity === 'warehouse' && <Field label="الكود"><input className="input num" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>}
            <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
            <div className="row"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} /> {f.active ? 'نشط' : 'موقوف'}</div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
