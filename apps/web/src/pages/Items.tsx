import { bpToPercent, formatMoney, formatQty, parsePercentBp, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, exportCsv, Field, MoneyInput, QtyInput, SearchBox, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { useDebounced, usePerm, useSettings } from '../lib/hooks';

export function ItemsPage() {
  const can = usePerm();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const dq = useDebounced(q);

  const data = useLiveQuery(async () => {
    const items = await db.items.orderBy('code').toArray();
    const bal = await db.stock_balances.toArray();
    const qty = new Map<string, number>();
    bal.forEach((b) => qty.set(b.item_id, (qty.get(b.item_id) ?? 0) + b.qty));
    const cats = await db.categories.toArray();
    return { items, qty, cats };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const s = dq.trim().toLowerCase();
    return data.items.filter(
      (i) => (showInactive || i.active !== false) && (!cat || i.category_id === cat) && (!s || [i.name, i.code, i.barcode].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, dq, cat, showInactive]);
  const catName = new Map((data?.cats ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="page">
      <PageHeader
        title="الأصناف"
        sub={`${list.length} صنف`}
        actions={
          <>
            <button
              className="btn"
              onClick={() =>
                exportCsv(
                  'الأصناف',
                  ['الكود', 'الاسم', 'الباركود', 'التصنيف', 'الوحدة', 'سعر البيع', 'سعر الجملة', 'الرصيد', 'حد الطلب'],
                  list.map((i) => [i.code, i.name, i.barcode, catName.get(i.category_id), i.base_unit, formatMoney(i.sale_price), formatMoney(i.wholesale_price), formatQty(data?.qty.get(i.id) ?? 0), formatQty(i.reorder_level)]),
                )
              }
            >
              تصدير
            </button>
            {can('items.create') && (
              <button className="btn primary" onClick={() => setEditing({})}>
                <Plus /> صنف جديد
              </button>
            )}
          </>
        }
      />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو الكود أو الباركود" autoFocus />
        </div>
        <select className="select" style={{ width: 180 }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {data?.cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="row small muted">
          <Switch checked={showInactive} onChange={setShowInactive} /> الموقوفة
        </label>
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<Package />} title={dq ? 'لا نتائج' : 'لا توجد أصناف'}>
            {!dq && can('items.create') && 'أضف أول صنف بالضغط على «صنف جديد».'}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>التصنيف</th>
                <th>الوحدة</th>
                <th className="n">سعر البيع</th>
                <th className="n">الرصيد</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const qty = data?.qty.get(i.id) ?? 0;
                const low = i.reorder_level > 0 && qty <= i.reorder_level;
                return (
                  <tr key={i.id} className="click" onClick={() => (can('items.edit') ? setEditing(i) : nav(`/items/inquiry?id=${i.id}`))}>
                    <td data-label="الكود" className="num">{i.code}</td>
                    <td data-label="الاسم">
                      <span className="bold">{i.name}</span> {i.active === false && <span className="badge">موقوف</span>}
                    </td>
                    <td data-label="التصنيف" className="muted">{catName.get(i.category_id) ?? '—'}</td>
                    <td data-label="الوحدة">{i.base_unit}</td>
                    <td data-label="سعر البيع" className="n">{formatMoney(i.sale_price)}</td>
                    <td data-label="الرصيد" className={`n ${low ? 'red bold' : ''}`}>{formatQty(qty)}</td>
                    <td data-label="">
                      <SyncBadge sync={i._sync} error={i._error} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ItemEditor item={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function ItemEditor({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const ui = useUi();
  const settings = useSettings();
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const existingUnits = useLiveQuery(async () => (item ? (await db.item_units.where('item_id').equals(item.id).toArray()).filter((u) => u.active !== false) : []), [item?.id]);
  const [f, setF] = useState<any>(() => ({
    code: item?.code ?? '',
    name: item?.name ?? '',
    barcode: item?.barcode ?? '',
    category_id: item?.category_id ?? 'cat-general',
    base_unit: item?.base_unit ?? 'قطعة',
    sale_price: item?.sale_price ?? 0,
    wholesale_price: item?.wholesale_price ?? 0,
    reorder_level: item?.reorder_level ?? 0,
    tax_rate_bp: item?.tax_rate_bp ?? settings.default_tax_rate_bp ?? 0,
    active: item?.active ?? true,
    notes: item?.notes ?? '',
    min_price: item?.min_price ?? 0,
    is_service: item?.is_service ?? false,
    track_serial: item?.track_serial ?? false,
    track_expiry: item?.track_expiry ?? false,
    expiry_default_days: item?.expiry_default_days ?? 0,
    expiry_alert_days: item?.expiry_alert_days ?? 30,
  }));
  const priceLists = useLiveQuery(async () => (await db.price_lists.orderBy('sort').toArray()).filter((p) => p.active !== false), []) ?? [];
  const existingPrices = useLiveQuery(async () => (item ? db.item_prices.where('item_id').equals(item.id).toArray() : []), [item?.id]);
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  const priceMap: Record<string, number> = prices ?? Object.fromEntries((existingPrices ?? []).map((p) => [`${p.unit_name}|${p.price_list_id}`, p.price]));
  const [units, setUnits] = useState<any[] | null>(null);
  // الإعدادات تُقرأ من IndexedDB بشكل غير متزامن: نطبق نسبة الضريبة الافتراضية عند وصولها للصنف الجديد
  useEffect(() => {
    if (!item && settings.default_tax_rate_bp !== undefined) setF((p: any) => (p._taxTouched ? p : { ...p, tax_rate_bp: settings.default_tax_rate_bp }));
  }, [item, settings.default_tax_rate_bp]);
  const [err, setErr] = useState<string | null>(null);
  const allUnits = units ?? existingUnits ?? [];
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));

  const suggestCode = async () => {
    const all = await db.items.toArray();
    const nums = all.map((i) => Number(i.code)).filter((n) => Number.isInteger(n));
    set('code', String((nums.length ? Math.max(...nums) : 0) + 1));
  };

  const save = async () => {
    setErr(null);
    if (!f.code.trim() || !f.name.trim()) return setErr('الكود والاسم مطلوبان');
    const dupCode = await db.items.where('code').equals(f.code.trim()).first();
    if (dupCode && dupCode.id !== item?.id) return setErr('الكود مستخدم لصنف آخر');
    if (f.barcode) {
      const dupB = await db.items.where('barcode').equals(f.barcode.trim()).first();
      const dupU = await db.item_units.where('barcode').equals(f.barcode.trim()).first();
      if ((dupB && dupB.id !== item?.id) || (dupU && dupU.item_id !== item?.id)) return setErr('الباركود مستخدم لصنف آخر');
    }
    for (const u of allUnits) {
      if (!u.name?.trim() || !u.factor) return setErr('أكمل بيانات الوحدات الإضافية (الاسم ومعامل التحويل)');
      if (u.name.trim() === f.base_unit.trim()) return setErr('اسم الوحدة الإضافية يجب أن يختلف عن الوحدة الأساسية');
    }
    const id = item?.id ?? uuid();
    await saveMaster(
      'item',
      id,
      {
        ...Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_'))),
        code: f.code.trim(),
        name: f.name.trim(),
        barcode: f.barcode?.trim() || null,
        units: allUnits.map((u) => ({ id: u.id, name: u.name.trim(), factor: u.factor, barcode: u.barcode?.trim() || null, sale_price: u.sale_price ?? 0, wholesale_price: u.wholesale_price ?? 0, active: true })),
        prices: prices
          ? Object.entries(prices).map(([k, price]) => {
              const [unit_name, price_list_id] = k.split('|');
              return { unit_name, price_list_id, price };
            })
          : [],
      },
      item,
    );
    ui.toast(item ? 'تم حفظ التعديل' : 'تمت إضافة الصنف');
    onSaved?.(id);
    onClose();
  };

  return (
    <Sheet
      title={item ? 'تعديل صنف' : 'صنف جديد'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={save}>حفظ</button>
        </>
      }
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        {item?._sync === 'rejected' && <Banner kind="err">لم يُقبل آخر حفظ على الخادم: {item._error}</Banner>}
        <div className="grid grid-3">
          <Field label="الكود *">
            <div className="row">
              <input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} autoFocus={!item} />
              {!item && <button type="button" className="btn sm" onClick={suggestCode}>تلقائي</button>}
            </div>
          </Field>
          <Field label="اسم الصنف *" className="span-2" >
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="الباركود" hint="امسح الباركود بالماسح الضوئي داخل الحقل">
            <input className="input num" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </Field>
          <Field label="التصنيف">
            <select className="select" value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="الوحدة الأساسية">
            <input className="input" value={f.base_unit} onChange={(e) => set('base_unit', e.target.value)} disabled={!!item} />
          </Field>
          <Field label="سعر البيع (قطاعي)">
            <MoneyInput value={f.sale_price} onChange={(v) => set('sale_price', v)} />
          </Field>
          <Field label="سعر الجملة" hint="يُستخدم للعملاء المسجلين على قائمة الجملة">
            <MoneyInput value={f.wholesale_price} onChange={(v) => set('wholesale_price', v)} />
          </Field>
          <Field label="نسبة الضريبة %">
            <TaxInput bp={f.tax_rate_bp} onChange={(v) => setF((p: any) => ({ ...p, tax_rate_bp: v, _taxTouched: true }))} />
          </Field>
          <Field label="حد إعادة الطلب" hint="يظهر الصنف في تقرير النواقص عند الوصول لهذه الكمية أو أقل">
            <QtyInput value={f.reorder_level} onChange={(v) => set('reorder_level', v)} />
          </Field>
          <Field label="أقل سعر بيع" hint="البيع بأقل منه يحتاج صلاحية خاصة">
            <MoneyInput value={f.min_price} onChange={(v) => set('min_price', v)} />
          </Field>
          <Field label="الحالة">
            <div className="row" style={{ height: 42 }}>
              <Switch checked={f.active} onChange={(v) => set('active', v)} /> {f.active ? 'نشط' : 'موقوف'}
            </div>
          </Field>
        </div>
        <div className="list" style={{ background: 'var(--bg)' }}>
          <div className="list-row" style={{ background: 'transparent' }}>
            <div className="title">خدمة بدون مخزون<div className="sub">مثل التركيب والصيانة: لا رصيد ولا تكلفة</div></div>
            <Switch checked={f.is_service} onChange={(v) => setF((p: any) => ({ ...p, is_service: v, track_serial: v ? false : p.track_serial, track_expiry: v ? false : p.track_expiry }))} />
          </div>
          <div className="list-row" style={{ background: 'transparent' }}>
            <div className="title">تتبع الأرقام التسلسلية (سيريال)<div className="sub">يدخل السيريال بالشراء ولا يُصرف إلا إذا كان بالمخزن، ولا يُباع مرتين</div></div>
            <Switch checked={f.track_serial} onChange={(v) => set('track_serial', v)} disabled={f.is_service} />
          </div>
          <div className="list-row" style={{ background: 'transparent' }}>
            <div className="title">تتبع تاريخ الصلاحية<div className="sub">كل وارد دفعة بتاريخ انتهاء، والصرف من الأقرب انتهاءً</div></div>
            <Switch checked={f.track_expiry} onChange={(v) => set('track_expiry', v)} disabled={f.is_service} />
          </div>
          {f.track_expiry && (
            <div className="list-row" style={{ background: 'transparent' }}>
              <Field label="صلاحية افتراضية بعد (يوم) من تاريخ الوارد"><input className="input num" type="number" min={0} value={f.expiry_default_days} onChange={(e) => set('expiry_default_days', Math.max(0, Number(e.target.value) || 0))} /></Field>
              <Field label="تنبيه قبل الانتهاء بـ (يوم)"><input className="input num" type="number" min={0} value={f.expiry_alert_days} onChange={(e) => set('expiry_alert_days', Math.max(0, Number(e.target.value) || 0))} /></Field>
            </div>
          )}
        </div>
        {priceLists.length > 0 && (
          <>
            <div className="bold" style={{ marginTop: 6 }}>أسعار قوائم الأسعار</div>
            <div className="footnote">اترك الخانة 0 لاستخدام سعر البيع الافتراضي للوحدة.</div>
            <div className="table-wrap" style={{ background: 'var(--bg)' }}>
              <table className="table">
                <thead><tr><th>الوحدة</th>{priceLists.map((pl) => <th key={pl.id}>{pl.name}</th>)}</tr></thead>
                <tbody>
                  {[f.base_unit, ...allUnits.map((u) => u.name).filter(Boolean)].map((un) => (
                    <tr key={un}>
                      <td className="bold">{un}</td>
                      {priceLists.map((pl) => (
                        <td key={pl.id} style={{ minWidth: 110 }}>
                          <MoneyInput value={priceMap[`${un}|${pl.id}`] ?? 0} onChange={(v) => setPrices({ ...priceMap, [`${un}|${pl.id}`]: v })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Field label="ملاحظات">
          <textarea className="textarea" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div className="row" style={{ marginTop: 6 }}>
          <div className="bold" style={{ flex: 1 }}>وحدات إضافية</div>
          <button
            type="button"
            className="btn sm"
            onClick={() => setUnits([...allUnits, { id: uuid(), name: '', factor: 0, barcode: '', sale_price: 0, wholesale_price: 0 }])}
          >
            <Plus /> وحدة
          </button>
        </div>
        <div className="footnote">مثال: «كرتونة» = 12 {f.base_unit}. الكميات تُحوّل تلقائيًا للوحدة الأساسية في المخزون.</div>
        {allUnits.map((u, i) => {
          const upd = (k: string, v: unknown) => setUnits(allUnits.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <div key={u.id} className="card pad grid grid-4" style={{ background: 'var(--bg)', alignItems: 'end' }}>
              <Field label="اسم الوحدة">
                <input className="input" value={u.name} onChange={(e) => upd('name', e.target.value)} />
              </Field>
              <Field label={`تحتوي كم ${f.base_unit}`}>
                <QtyInput value={u.factor} onChange={(v) => upd('factor', v)} />
              </Field>
              <Field label="سعر بيع الوحدة">
                <MoneyInput value={u.sale_price} onChange={(v) => upd('sale_price', v)} />
              </Field>
              <div className="row">
                <Field label="باركود الوحدة">
                  <input className="input num" value={u.barcode ?? ''} onChange={(e) => upd('barcode', e.target.value)} />
                </Field>
                <button type="button" className="icon-btn" style={{ color: 'var(--red)', marginTop: 20 }} onClick={() => setUnits(allUnits.filter((_, j) => j !== i))} aria-label="حذف الوحدة">
                  <Trash2 />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function TaxInput({ bp, onChange }: { bp: number; onChange: (bp: number) => void }) {
  const [t, setT] = useState(bpToPercent(bp));
  useEffect(() => setT(bpToPercent(bp)), [bp]);
  return (
    <input
      className="input num"
      inputMode="decimal"
      value={t}
      onChange={(e) => {
        setT(e.target.value);
        try {
          const v = parsePercentBp(e.target.value);
          if (v >= 0 && v <= 10000) onChange(v);
        } catch {
          /* قيمة غير مكتملة */
        }
      }}
    />
  );
}
