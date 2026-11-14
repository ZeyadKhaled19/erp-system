/** تقارير المخزون: الحركة والأرصدة والطلب والسيريال والصلاحية والسالب */
import { DOC_TYPES, formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exportExcel, Field, Picker, Segmented } from '../../components/ui';
import { db } from '../../lib/db';
import { usePerm, useRemote } from '../../lib/hooks';
import { CategoryFilter } from '../../components/Categories';
import { monthStart, yearStart, docLabel, Shell, DateRange, useItemOptions, useWarehouses } from './shared';

// ---------------------------------------------------------------- حركة صنف
export function ItemMovementReport() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const can = usePerm();
  const items = useItemOptions();
  const whs = useWarehouses();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayISO());
  const [wh, setWh] = useState('');
  const [dt, setDt] = useState('');
  const id = sp.get('id');
  const r = useRemote<any>(id ? `/api/reports/item/${id}?from=${from}&to=${to}&warehouse_id=${wh}&doc_type=${dt}` : null);
  return (
    <Shell
      title="تقرير حركة صنف"
      sub={r.data?.item?.name}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="الصنف"><Picker value={id} options={items} onChange={(v) => setSp(v ? { id: v } : {})} /></Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="المخزن">
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">كل المخازن</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="نوع الحركة">
            <select className="select" value={dt} onChange={(e) => setDt(e.target.value)}>
              <option value="">كل الأنواع</option>
              {Object.entries(DOC_TYPES).filter(([, i]) => i.stock).map(([k, i]) => <option key={k} value={k}>{i.label}</option>)}
            </select>
          </Field>
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportExcel('حركة صنف', ['التاريخ', 'المستند', 'النوع', 'المخزن', 'الطرف', 'وارد', 'منصرف', 'الرصيد'], r.data.moves.map((m: any) => [m.date, m.doc_number, docLabel(m.doc_type), m.warehouse_name, m.party_name, m.qty > 0 ? formatQty(m.qty) : '', m.qty < 0 ? formatQty(-m.qty) : '', m.balance != null ? formatQty(m.balance) : '']))}>تصدير Excel</button>}
      note="الكميات بالوحدة الأساسية للصنف. الحركات العكسية ناتجة عن إلغاء مستندات."
    >
      {!id && <div className="card pad muted">اختر صنفًا لعرض حركته.</div>}
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>المخزن</th><th>الطرف</th><th className="n">وارد</th><th className="n">منصرف</th>{can('costs.view') && <th className="n">القيمة</th>}<th className="n">الرصيد</th></tr></thead>
            <tbody>
              {!dt && <tr><td colSpan={can('costs.view') ? 8 : 7} className="muted">رصيد أول المدة</td><td className="n bold">{formatQty(r.data.opening)}</td></tr>}
              {r.data.moves.map((m: any) => (
                <tr key={m.id} className="click" onClick={() => nav(`/docs/view/${m.document_id}`)}>
                  <td data-label="التاريخ" className="num">{m.date}</td>
                  <td data-label="المستند" className="num">{m.doc_number}</td>
                  <td data-label="النوع">{docLabel(m.doc_type)} {m.reversal && <span className="badge red">عكس</span>}</td>
                  <td data-label="المخزن">{m.warehouse_name}</td>
                  <td data-label="الطرف">{m.party_name ?? ''}</td>
                  <td data-label="وارد" className="n green">{m.qty > 0 ? formatQty(m.qty) : ''}</td>
                  <td data-label="منصرف" className="n red">{m.qty < 0 ? formatQty(-m.qty) : ''}</td>
                  {can('costs.view') && <td data-label="القيمة" className="n">{m.value != null ? formatMoney(Math.abs(m.value)) : ''}</td>}
                  <td data-label="الرصيد" className="n bold">{m.balance != null ? formatQty(m.balance) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- بضاعة مخزن
export function StockReport() {
  const whs = useWarehouses();
  const can = usePerm();
  const nav = useNavigate();
  const [wh, setWh] = useState('');
  const [nonzero, setNonzero] = useState(true);
  const [cat, setCat] = useState('');
  const catList = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')), []) ?? [];
  // التقرير محلي بالكامل (من آخر مزامنة) ليعمل دون اتصال
  const data = useLiveQuery(async () => {
    const items = await db.items.orderBy('code').toArray();
    const bal = await db.stock_balances.toArray();
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c.name]));
    const rows = items.map((i: any) => {
      const b = bal.filter((x) => x.item_id === i.id && (!wh || x.warehouse_id === wh));
      const qty = b.reduce((s, x) => s + x.qty, 0);
      // قيمة بيع تقديرية (سعر البيع × الكمية الموجبة) — منفصلة تمامًا عن التكلفة والربح
      return { ...i, qty, value: b.reduce((s, x) => s + x.value, 0), sale_value: qty > 0 ? Math.round((qty * (i.sale_price ?? 0)) / 1000) : 0, cat: cats.get(i.category_id) };
    });
    return rows.filter((r) => (!nonzero || r.qty !== 0) && (!cat || r.category_id === cat));
  }, [wh, nonzero, cat]) ?? [];
  const total = data.reduce((s, r) => s + r.value, 0);
  const saleTotal = data.reduce((s, r) => s + r.sale_value, 0);
  return (
    <Shell
      title="تقرير بضاعة مخزن"
      sub={`${data.length} صنف${can('costs.view') ? ` · القيمة بالتكلفة ${formatMoney(total)}` : ''} · بسعر البيع (تقديري) ${formatMoney(saleTotal)}`}
      filters={
        <>
          <Field label="المخزن">
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">كل المخازن</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          {catList.length > 1 && (
            <Field label="التصنيف">
              <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">كل التصنيفات</option>
                {catList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="العرض"><Segmented block value={nonzero ? '1' : '0'} onChange={(v) => setNonzero(v === '1')} options={[{ value: '1', label: 'الأصناف ذات الرصيد' }, { value: '0', label: 'كل الأصناف' }]} /></Field>
        </>
      }
      actions={<button className="btn" onClick={() => exportExcel('بضاعة مخزن', ['الكود', 'الصنف', 'التصنيف', 'الوحدة', 'الكمية', ...(can('costs.view') ? ['متوسط التكلفة', 'القيمة بالتكلفة'] : []), 'سعر البيع', 'القيمة بسعر البيع (تقديرية)'], data.map((r) => [r.code, r.name, r.cat, r.base_unit, formatQty(r.qty), ...(can('costs.view') ? [r.qty ? formatMoney(Math.round((r.value * 1000) / r.qty)) : '', formatMoney(r.value)] : []), formatMoney(r.sale_price ?? 0), formatMoney(r.sale_value)]))}>تصدير Excel</button>}
      note="القيمة بالتكلفة = الكمية المتبقية × متوسط تكلفة الشراء (المتوسط المرجح). القيمة بسعر البيع تقديرية فقط ولا تُستخدم كتكلفة أو ربح. الأرصدة حسب آخر مزامنة."
    >
      <div className="table-wrap">
        <table className="table responsive">
          <thead><tr><th>الكود</th><th>الصنف</th><th>التصنيف</th><th>الوحدة</th><th className="n">الكمية</th>{can('costs.view') && <><th className="n">متوسط التكلفة</th><th className="n">القيمة بالتكلفة</th></>}<th className="n">بسعر البيع (تقديري)</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/reports/item?id=${r.id}`)}>
                <td data-label="الكود" className="num">{r.code}</td>
                <td data-label="الصنف" className="bold">{r.name}</td>
                <td data-label="التصنيف" className="muted">{r.cat ?? ''}</td>
                <td data-label="الوحدة">{r.base_unit}</td>
                <td data-label="الكمية" className={`n bold ${r.qty < 0 ? 'red' : ''}`}>{formatQty(r.qty)}</td>
                {can('costs.view') && <><td data-label="متوسط التكلفة" className="n">{r.qty > 0 ? formatMoney(Math.round((r.value * 1000) / r.qty)) : ''}</td><td data-label="القيمة بالتكلفة" className="n">{formatMoney(r.value)}</td></>}
                <td data-label="بسعر البيع" className="n muted">{r.sale_value ? formatMoney(r.sale_value) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={can('costs.view') ? 6 : 5}>الإجمالي</td>{can('costs.view') && <td className="n">{formatMoney(total)}</td>}<td className="n">{formatMoney(saleTotal)}</td></tr></tfoot>
        </table>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- حركة مخزن
export function WarehouseMovementReport() {
  const whs = useWarehouses();
  const items = useItemOptions();
  const nav = useNavigate();
  const [wh, setWh] = useState('');
  const [item, setItem] = useState<string | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const whId = wh || whs[0]?.id;
  const r = useRemote<any>(whId ? `/api/reports/warehouse-movement/${whId}?from=${from}&to=${to}&item_id=${item ?? ''}` : null);
  return (
    <Shell
      title="تقرير حركة مخزن"
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="المخزن">
            <select className="select" value={whId ?? ''} onChange={(e) => setWh(e.target.value)}>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="الصنف (اختياري)"><Picker value={item} options={items} onChange={setItem} allowClear placeholder="كل الأصناف" /></Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportExcel('حركة مخزن', ['التاريخ', 'المستند', 'النوع', 'الصنف', 'وارد', 'منصرف', 'الرصيد بعد الحركة'], r.data.moves.map((m: any) => [m.date, m.doc_number, docLabel(m.doc_type), m.item_name, m.qty > 0 ? formatQty(m.qty) : '', m.qty < 0 ? formatQty(-m.qty) : '', formatQty(m.balance_qty)]))}>تصدير Excel</button>}
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>الصنف</th><th className="n">وارد</th><th className="n">منصرف</th><th className="n">رصيد الصنف بعدها</th></tr></thead>
            <tbody>
              {r.data.moves.length === 0 && <tr><td colSpan={7} className="muted">لا توجد حركات</td></tr>}
              {r.data.moves.map((m: any) => (
                <tr key={m.id} className="click" onClick={() => nav(`/docs/view/${m.document_id}`)}>
                  <td data-label="التاريخ" className="num">{m.date}</td>
                  <td data-label="المستند" className="num">{m.doc_number}</td>
                  <td data-label="النوع">{docLabel(m.doc_type)} {m.reversal && <span className="badge red">عكس</span>}</td>
                  <td data-label="الصنف">{m.item_name}</td>
                  <td data-label="وارد" className="n green">{m.qty > 0 ? formatQty(m.qty) : ''}</td>
                  <td data-label="منصرف" className="n red">{m.qty < 0 ? formatQty(-m.qty) : ''}</td>
                  <td data-label="الرصيد" className="n">{formatQty(m.balance_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- حد الطلب
export function ReorderReport() {
  const nav = useNavigate();
  const [cat, setCat] = useState('');
  const data = useLiveQuery(async () => {
    const items = (await db.items.toArray()).filter((i) => i.active !== false && i.reorder_level > 0 && (!cat || i.category_id === cat));
    const bal = await db.stock_balances.toArray();
    return items
      .map((i: any) => ({ ...i, qty: bal.filter((b) => b.item_id === i.id).reduce((s, b) => s + b.qty, 0) }))
      .filter((i) => i.qty <= i.reorder_level)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [cat]) ?? [];
  return (
    <Shell
      title="الأصناف تحت حد الطلب"
      sub={`${data.length} صنف وصل لحد إعادة الطلب أو أقل`}
      actions={<><CategoryFilter value={cat} onChange={setCat} /><button className="btn" onClick={() => exportExcel('النواقص', ['الكود', 'الصنف', 'الرصيد', 'حد الطلب', 'العجز'], data.map((r) => [r.code, r.name, formatQty(r.qty), formatQty(r.reorder_level), formatQty(r.reorder_level - r.qty)]))}>تصدير Excel</button></>}
      note="يعرض فقط الأصناف التي لها حد طلب أكبر من صفر ورصيدها الإجمالي (كل المخازن) أقل من أو يساوي الحد."
    >
      <div className="table-wrap">
        <table className="table responsive">
          <thead><tr><th>الكود</th><th>الصنف</th><th className="n">الرصيد</th><th className="n">حد الطلب</th><th className="n">العجز عن الحد</th></tr></thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={5} className="muted">لا توجد أصناف تحت حد الطلب</td></tr>}
            {data.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/items/inquiry?id=${r.id}`)}>
                <td data-label="الكود" className="num">{r.code}</td>
                <td data-label="الصنف" className="bold">{r.name}</td>
                <td data-label="الرصيد" className="n red bold">{formatQty(r.qty)}</td>
                <td data-label="حد الطلب" className="n">{formatQty(r.reorder_level)}</td>
                <td data-label="العجز" className="n">{formatQty(r.reorder_level - r.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- بحث السيريال
export function SerialSearchReport() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const r = useRemote<any>(term ? `/api/reports/serial?q=${encodeURIComponent(term)}` : null);
  const ST: Record<string, string> = { in_stock: 'بالمخزن', sold: 'مُباع', returned_to_supplier: 'خارج المخزن' };
  return (
    <Shell title="بحث برقم السيريال" error={r.error} loading={r.loading} filters={<Field label="رقم السيريال"><input className="input num" value={q} autoFocus onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setTerm(q.trim())} placeholder="امسح أو اكتب ثم Enter" /></Field>}>
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>السيريال</th><th>الصنف</th><th>الحالة الحالية</th><th>الحركة</th><th>المستند</th><th>التاريخ</th><th>الطرف</th><th>المخزن</th></tr></thead>
            <tbody>
              {r.data.rows.length === 0 && <tr><td colSpan={8} className="muted">لا نتائج</td></tr>}
              {r.data.rows.map((x: any, i: number) => (
                <tr key={i} className={x.document_id ? 'click' : ''} onClick={() => x.document_id && nav(`/docs/view/${x.document_id}`)}>
                  <td data-label="السيريال" className="num bold">{x.serial}</td>
                  <td data-label="الصنف">{x.item_name}</td>
                  <td data-label="الحالة"><span className={`badge ${x.status === 'in_stock' ? 'green' : ''}`}>{ST[x.status]}</span></td>
                  <td data-label="الحركة">{x.direction === 'in' ? 'وارد' : x.direction === 'out' ? 'منصرف' : ''} {x.reversal && <span className="badge red">عكس</span>}</td>
                  <td data-label="المستند" className="num">{x.number} {x.doc_type ? `(${docLabel(x.doc_type)})` : ''}</td>
                  <td data-label="التاريخ" className="num">{x.date}</td>
                  <td data-label="الطرف">{x.party_name ?? ''}</td>
                  <td data-label="المخزن">{x.warehouse_name ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- الصلاحية
export function ExpiryReport() {
  const whs = useWarehouses();
  const can = usePerm();
  const [wh, setWh] = useState('');
  const [until, setUntil] = useState('');
  const r = useRemote<any>(`/api/reports/expiry?warehouse_id=${wh}&until=${until}`);
  return (
    <Shell
      title="تقرير صلاحية الأصناف"
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="المخزن"><select className="select" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">كل المخازن</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="صلاحية حتى تاريخ"><input type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportExcel('الصلاحية', ['الصنف', 'المخزن', 'تاريخ الانتهاء', 'الأيام المتبقية', 'الكمية'], r.data.rows.map((x: any) => [x.name, x.warehouse_name, x.expiry, x.days_left, formatQty(x.qty)]))}>تصدير Excel</button>}
      note="الكميات المتاحة فقط لكل دفعة. الصرف يتم تلقائيًا من الأقرب انتهاءً. التنبيه حسب «تنبيه قبل» في بطاقة الصنف."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الصنف</th><th>المخزن</th><th>تاريخ الانتهاء</th><th className="n">متبقي (يوم)</th><th className="n">الكمية</th>{can('costs.view') && <th className="n">القيمة التقريبية</th>}</tr></thead>
            <tbody>
              {r.data.rows.length === 0 && <tr><td colSpan={6} className="muted">لا توجد دفعات</td></tr>}
              {r.data.rows.map((x: any) => {
                const expired = x.days_left < 0;
                const soon = !expired && x.days_left <= (x.expiry_alert_days ?? 30);
                return (
                  <tr key={x.id}>
                    <td data-label="الصنف" className="bold">{x.code} — {x.name}</td>
                    <td data-label="المخزن">{x.warehouse_name}</td>
                    <td data-label="الانتهاء" className="num">{x.expiry}</td>
                    <td data-label="متبقي" className={`n ${expired ? 'red bold' : soon ? 'orange bold' : ''}`}>{expired ? `منتهي منذ ${-x.days_left}` : x.days_left}</td>
                    <td data-label="الكمية" className="n">{formatQty(x.qty)} {x.base_unit}</td>
                    {can('costs.view') && <td data-label="القيمة" className="n">{formatMoney(Math.round((x.qty * x.avg_cost) / 1000))}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- أرصدة سالبة تحتاج مراجعة
/** الأصناف التي صار رصيدها سالبًا (بيع أوفلاين من أكثر من جهاز أو بيع بدون رصيد) — من آخر مزامنة */
export function useNegativeStock() {
  return (
    useLiveQuery(async () => {
      const neg = (await db.stock_balances.toArray()).filter((b) => b.qty < 0);
      if (!neg.length) return [];
      const items = new Map((await db.items.bulkGet([...new Set(neg.map((b) => b.item_id))])).filter(Boolean).map((i: any) => [i.id, i]));
      const whs = new Map((await db.warehouses.toArray()).map((w) => [w.id, w.name]));
      return neg
        .map((b) => ({ ...b, item: items.get(b.item_id), warehouse_name: whs.get(b.warehouse_id) }))
        .filter((b) => b.item && !b.item.is_service)
        .sort((a, b) => a.qty - b.qty);
    }, []) ?? []
  );
}

export function NegativeStockReport() {
  const nav = useNavigate();
  const can = usePerm();
  const rows = useNegativeStock();
  return (
    <Shell
      title="أرصدة سالبة تحتاج مراجعة"
      sub={rows.length ? `${rows.length} صنف/مخزن` : 'لا توجد أرصدة سالبة'}
      actions={rows.length > 0 && <button className="btn" onClick={() => exportExcel('أرصدة سالبة', ['الكود', 'الصنف', 'المخزن', 'الرصيد', 'الوحدة'], rows.map((r: any) => [r.item.code, r.item.name, r.warehouse_name, formatQty(r.qty), r.item.base_unit]))}>تصدير Excel</button>}
      note="الفواتير لا تُسقط ولا تُعدّل: البيع يُسجّل كما هو، والرصيد السالب يظهر هنا حتى يُعالج بفاتورة شراء أو تحويل من مخزن آخر أو جرد وتسوية. افتح حركة الصنف لمعرفة الفواتير التي سببت العجز."
    >
      {rows.length === 0 ? (
        <div className="card pad muted">كل الأرصدة سليمة — لا يوجد صنف رصيده أقل من صفر.</div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الكود</th><th>الصنف</th><th>المخزن</th><th className="n">الرصيد</th><th className="no-print">معالجة</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={`${r.item_id}-${r.warehouse_id}`}>
                  <td data-label="الكود" className="num">{r.item.code}</td>
                  <td data-label="الصنف" className="bold">{r.item.name}</td>
                  <td data-label="المخزن">{r.warehouse_name}</td>
                  <td data-label="الرصيد" className="n bold red">{formatQty(r.qty)} {r.item.base_unit}</td>
                  <td data-label="معالجة" className="no-print">
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => nav(`/reports/item?id=${r.item_id}`)}>حركة الصنف</button>
                      {can('purchases.create') && <button className="btn sm" onClick={() => nav('/docs/new/purchase_invoice')}>فاتورة شراء</button>}
                      {can('inventory.create') && <button className="btn sm" onClick={() => nav('/docs/new/stock_transfer')}>تحويل</button>}
                      {can('inventory.create') && <button className="btn sm" onClick={() => nav('/docs/new/stock_adjustment')}>جرد وتسوية</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
