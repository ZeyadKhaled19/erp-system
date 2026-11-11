import { bpToPercent, parsePercentBp, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Field, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';

/** قوائم الأسعار ومندوبو المبيعات */
export function ListsPage() {
  const can = usePerm();
  const ui = useUi();
  const lists = useLiveQuery(() => db.price_lists.orderBy('sort').toArray(), []) ?? [];
  const reps = useLiveQuery(() => db.sales_reps.orderBy('name').toArray(), []) ?? [];
  const [pl, setPl] = useState<any | null>(null);
  const [rep, setRep] = useState<any | null>(null);
  return (
    <div className="page narrow">
      <PageHeader title="قوائم الأسعار والمندوبون" />
      <div className="row"><div className="section-title" style={{ flex: 1, margin: 0 }}>قوائم الأسعار</div>{can('settings.manage') && <button className="btn sm" onClick={() => setPl({ name: '', sort: lists.length + 1, active: true })}><Plus /> قائمة</button>}</div>
      <div className="footnote" style={{ margin: '6px 0 10px' }}>تُحدد أسعار كل صنف لكل قائمة من شاشة الصنف. العميل يرتبط بقائمة افتراضية، ويمكن تغييرها في الفاتورة لمن لديه صلاحية تغيير الأسعار.</div>
      <div className="list">
        {lists.map((l) => (
          <div key={l.id} className="list-row tappable" onClick={() => can('settings.manage') && setPl(l)}>
            <span className="num muted" style={{ width: 30 }}>{l.sort}</span>
            <div className="title">{l.name}</div>
            {l.active === false && <span className="badge">موقوفة</span>}
            <SyncBadge sync={l._sync} error={l._error} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 26 }}><div className="section-title" style={{ flex: 1, margin: 0 }}>مندوبو المبيعات</div>{can('parties.create') && <button className="btn sm" onClick={() => setRep({ name: '', phone: '', commission_bp: 0, active: true })}><Plus /> مندوب</button>}</div>
      <div className="list" style={{ marginTop: 10 }}>
        {reps.length === 0 && <div className="list-row muted">لا يوجد</div>}
        {reps.map((r) => (
          <div key={r.id} className="list-row tappable" onClick={() => can('parties.edit') && setRep(r)}>
            <div className="title">{r.name}<div className="sub num">{r.phone ?? ''}</div></div>
            <span className="caption">عمولة {bpToPercent(r.commission_bp)}%</span>
            {r.active === false && <span className="badge">موقوف</span>}
            <SyncBadge sync={r._sync} error={r._error} />
          </div>
        ))}
      </div>
      {pl && (
        <Sheet title={pl.id ? 'تعديل قائمة' : 'قائمة جديدة'} onClose={() => setPl(null)} footer={<><button className="btn" onClick={() => setPl(null)}>إلغاء</button><button className="btn primary" disabled={!pl.name?.trim()} onClick={async () => { await saveMaster('price_list', pl.id ?? uuid(), { name: pl.name.trim(), sort: Number(pl.sort) || 0, active: pl.active }, pl.id ? pl : null); ui.toast('تم الحفظ'); setPl(null); }}>حفظ</button></>}>
          <div className="stack">
            <Field label="الاسم"><input className="input" value={pl.name} onChange={(e) => setPl({ ...pl, name: e.target.value })} autoFocus /></Field>
            <Field label="الترتيب"><input className="input num" type="number" value={pl.sort} onChange={(e) => setPl({ ...pl, sort: e.target.value })} /></Field>
            <div className="row"><Switch checked={pl.active !== false} onChange={(v) => setPl({ ...pl, active: v })} /> نشطة</div>
          </div>
        </Sheet>
      )}
      {rep && (
        <Sheet
          title={rep.id ? 'تعديل مندوب' : 'مندوب جديد'}
          onClose={() => setRep(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRep(null)}>إلغاء</button>
              <button
                className="btn primary"
                disabled={!rep.name?.trim()}
                onClick={async () => {
                  let bp = 0;
                  try {
                    bp = parsePercentBp(String(rep.pct ?? bpToPercent(rep.commission_bp ?? 0)) || '0');
                  } catch {
                    return ui.toast('نسبة غير صالحة', 'err');
                  }
                  await saveMaster('sales_rep', rep.id ?? uuid(), { name: rep.name.trim(), phone: rep.phone || null, commission_bp: bp, active: rep.active !== false }, rep.id ? rep : null);
                  ui.toast('تم الحفظ');
                  setRep(null);
                }}
              >
                حفظ
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="الاسم"><input className="input" value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} autoFocus /></Field>
            <Field label="الهاتف"><input className="input num" value={rep.phone ?? ''} onChange={(e) => setRep({ ...rep, phone: e.target.value })} /></Field>
            <Field label="نسبة العمولة %" hint="تظهر في تحليل المبيعات حسب المندوب"><input className="input num" defaultValue={bpToPercent(rep.commission_bp ?? 0)} onChange={(e) => setRep({ ...rep, pct: e.target.value })} /></Field>
            <div className="row"><Switch checked={rep.active !== false} onChange={(v) => setRep({ ...rep, active: v })} /> نشط</div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
