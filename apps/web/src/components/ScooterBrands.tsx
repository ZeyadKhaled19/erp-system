import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bike, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { Banner, Field, Sheet, Switch, useUi } from './ui';

/** ماركات السكوتر مرتبة (الموقوفة بتظهر بس لو مطلوبة أو مختارة على العميل) */
export function useScooterBrands(withInactive = false, keepId?: string | null) {
  return (
    useLiveQuery(
      async () =>
        (await db.scooter_brands.toArray())
          .filter((b) => withInactive || b.active !== false || b.id === keepId)
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'ar')),
      [withInactive, keepId],
    ) ?? []
  );
}

/** إضافة أو تعديل ماركة (لصاحب صلاحية الإعدادات فقط) */
export function ScooterBrandSheet({ brand, onClose, onSaved }: { brand: any | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const ui = useUi();
  const [name, setName] = useState(brand?.name ?? '');
  const [active, setActive] = useState(brand?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('اكتب اسم الماركة');
    const all = await db.scooter_brands.toArray();
    if (all.some((b) => String(b.name).trim().toLowerCase() === n.toLowerCase() && b.id !== brand?.id)) return setErr('الماركة دي موجودة بالفعل');
    const id = brand?.id ?? uuid();
    await saveMaster('scooter_brand', id, { name: n, sort: brand?.sort ?? Math.max(0, ...all.map((b) => b.sort ?? 0)) + 1, active }, brand);
    ui.toast(brand ? 'اتعدلت الماركة' : `اتضافت الماركة «${n}»`);
    onSaved?.(id);
    onClose();
  };
  return (
    <Sheet
      title={brand ? 'تعديل ماركة السكوتر' : 'ماركة سكوتر جديدة'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={save}>حفظ</button>
        </>
      }
    >
      <div className="stack" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}>
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الماركة" required hint="مثال: SYM، Kymco، Vespa، Honda">
          <input className="input" style={{ fontSize: 17, height: 52 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {brand && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>نشطة (بتظهر للموظفين في الاختيار)</span>
            <Switch checked={active} onChange={setActive} />
          </div>
        )}
        {brand && <div className="footnote">تغيير الاسم بيظهر فورًا على كل العملاء اللي معاهم الماركة دي. الإيقاف بيخفيها من الاختيار بس، والعملاء القدام بيفضلوا عليها.</div>}
      </div>
    </Sheet>
  );
}

/** إدارة القائمة كلها: إضافة وتعديل وإيقاف، مع عدد العملاء لكل ماركة */
export function ScooterBrandsManager({ onClose }: { onClose: () => void }) {
  const brands = useScooterBrands(true);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    (await db.parties.where('kind').equals('customer').toArray()).forEach((p) => p.scooter_brand_id && m.set(p.scooter_brand_id, (m.get(p.scooter_brand_id) ?? 0) + 1));
    return m;
  }, []) ?? new Map<string, number>();
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  return (
    <Sheet title="ماركات السكوتر" onClose={onClose} footer={<button className="btn primary" onClick={() => setEdit(null)}><Plus /> ماركة جديدة</button>}>
      <div className="stack">
        <div className="footnote">القائمة دي بتظهر للموظفين في بيانات العميل يختاروا منها. تقرير «العملاء حسب ماركة السكوتر» في التقارير بيتحسب منها.</div>
        {brands.length === 0 ? (
          <div className="card pad muted">لسه مفيش ماركات. اضغط «ماركة جديدة» وضيف أول ماركة.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الماركة</th><th className="n">العملاء</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} className="click" onClick={() => setEdit(b)}>
                    <td className="bold"><Bike style={{ width: 16, height: 16, verticalAlign: -3, marginInlineEnd: 8 }} />{b.name}</td>
                    <td className="n">{counts.get(b.id) ?? 0}</td>
                    <td><span className={`badge ${b.active !== false ? 'green' : 'red'}`}>{b.active !== false ? 'نشطة' : 'موقوفة'}</span></td>
                    <td className="lp-act-cell"><button type="button" className="lp-act" aria-label={`تعديل ${b.name}`} onClick={(e) => { e.stopPropagation(); setEdit(b); }}><Pencil /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit !== undefined && <ScooterBrandSheet brand={edit} onClose={() => setEdit(undefined)} />}
    </Sheet>
  );
}

/** خانة اختيار الماركة في نموذج العميل، ومعاها زر إضافة لصاحب الصلاحية */
export function ScooterBrandSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const can = usePerm();
  const brands = useScooterBrands(false, value);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <select className="select" style={{ flex: 1 }} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="ماركة السكوتر">
          <option value="">{brands.length ? '— اختار الماركة —' : 'لسه مفيش ماركات متسجلة'}</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active === false ? ' (موقوفة)' : ''}</option>)}
        </select>
        {can('settings.manage') && <button type="button" className="btn" title="ماركة جديدة" aria-label="إضافة ماركة جديدة" onClick={() => setAdding(true)}><Plus /></button>}
      </div>
      {adding && <ScooterBrandSheet brand={null} onClose={() => setAdding(false)} onSaved={(id) => onChange(id)} />}
    </>
  );
}
