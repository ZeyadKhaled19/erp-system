import { ACCOUNT_TYPE_LABEL, DOC_TYPES, formatMoney, formatQty, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DocStatusBadge, exportCsv, Field, Picker, Segmented } from '../components/ui';
import { db } from '../lib/db';
import { useMap, usePerm, useRemote, useSettings } from '../lib/hooks';
import { CategoryFilter } from '../components/Categories';

const monthStart = () => `${todayISO().slice(0, 7)}-01`;
const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;

function Shell({ title, sub, filters, actions, error, loading, children, note }: { title: string; sub?: ReactNode; filters?: ReactNode; actions?: ReactNode; error?: string | null; loading?: boolean; children: ReactNode; note?: ReactNode }) {
  const settings = useSettings();
  return (
    <div className="page">
      <div className="print-only" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{settings.company_name}</div>
        <div>{title} — طُبع {new Date().toLocaleString('ar-EG')}</div>
      </div>
      <PageHeader title={title} sub={sub} actions={<>{actions}<button className="btn" onClick={() => window.print()}><Printer /> طباعة</button></>} />
      {filters && <div className="card pad no-print" style={{ marginBottom: 14 }}><div className="grid grid-4" style={{ alignItems: 'end' }}>{filters}</div></div>}
      {error && <div style={{ marginBottom: 12 }}><Banner kind="warn">{error}</Banner></div>}
      {loading && <div className="muted" style={{ marginBottom: 8 }}>جارٍ التحميل…</div>}
      {children}
      {note && <div className="footnote" style={{ marginTop: 12 }}>{note}</div>}
    </div>
  );
}

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <>
      <Field label="من تاريخ"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="إلى تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </>
  );
}

function useItemOptions() {
  return useLiveQuery(async () => {
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c.name]));
    return (await db.items.orderBy('code').toArray()).map((i) => ({ id: i.id, label: i.name, sub: i.code, search: `${i.name} ${i.code} ${i.barcode ?? ''}`, group: (i.category_id && cats.get(i.category_id)) || undefined }));
  }, []) ?? [];
}
function useWarehouses() {
  return useLiveQuery(() => db.warehouses.orderBy('code').toArray(), []) ?? [];
}
const docLabel = (t: string) => DOC_TYPES[t as DocType]?.label ?? t;

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
      actions={r.data && <button className="btn" onClick={() => exportCsv('حركة صنف', ['التاريخ', 'المستند', 'النوع', 'المخزن', 'الطرف', 'وارد', 'منصرف', 'الرصيد'], r.data.moves.map((m: any) => [m.date, m.doc_number, docLabel(m.doc_type), m.warehouse_name, m.party_name, m.qty > 0 ? formatQty(m.qty) : '', m.qty < 0 ? formatQty(-m.qty) : '', m.balance != null ? formatQty(m.balance) : '']))}>تصدير</button>}
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
      actions={<button className="btn" onClick={() => exportCsv('بضاعة مخزن', ['الكود', 'الصنف', 'التصنيف', 'الوحدة', 'الكمية', ...(can('costs.view') ? ['متوسط التكلفة', 'القيمة بالتكلفة'] : []), 'سعر البيع', 'القيمة بسعر البيع (تقديرية)'], data.map((r) => [r.code, r.name, r.cat, r.base_unit, formatQty(r.qty), ...(can('costs.view') ? [r.qty ? formatMoney(Math.round((r.value * 1000) / r.qty)) : '', formatMoney(r.value)] : []), formatMoney(r.sale_price ?? 0), formatMoney(r.sale_value)]))}>تصدير</button>}
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
      actions={r.data && <button className="btn" onClick={() => exportCsv('حركة مخزن', ['التاريخ', 'المستند', 'النوع', 'الصنف', 'وارد', 'منصرف', 'الرصيد بعد الحركة'], r.data.moves.map((m: any) => [m.date, m.doc_number, docLabel(m.doc_type), m.item_name, m.qty > 0 ? formatQty(m.qty) : '', m.qty < 0 ? formatQty(-m.qty) : '', formatQty(m.balance_qty)]))}>تصدير</button>}
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
      actions={<><CategoryFilter value={cat} onChange={setCat} /><button className="btn" onClick={() => exportCsv('النواقص', ['الكود', 'الصنف', 'الرصيد', 'حد الطلب', 'العجز'], data.map((r) => [r.code, r.name, formatQty(r.qty), formatQty(r.reorder_level), formatQty(r.reorder_level - r.qty)]))}>تصدير</button></>}
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

// ---------------------------------------------------------------- ميزان المراجعة
export function TrialBalanceReport() {
  const nav = useNavigate();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayISO());
  const [level, setLevel] = useState<'all' | 'leaf'>('all');
  const r = useRemote<any>(`/api/reports/trial-balance?from=${from}&to=${to}`);
  const rows = (r.data?.accounts ?? []).filter((a: any) => (a.opening || a.debit || a.credit || a.closing) && (level === 'all' || !a.is_group));
  const depth = (a: any) => {
    let d = 0;
    let p = a.parent_id;
    const m = new Map((r.data?.accounts ?? []).map((x: any) => [x.id, x]));
    while (p) {
      d++;
      p = (m.get(p) as any)?.parent_id;
    }
    return d;
  };
  return (
    <Shell
      title="ميزان المراجعة"
      sub={r.data && (r.data.balanced ? <span className="badge green">متوازن</span> : <span className="badge red">غير متوازن</span>)}
      error={r.error}
      loading={r.loading}
      filters={<><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /><Field label="المستوى"><Segmented block value={level} onChange={setLevel} options={[{ value: 'all', label: 'بالتجميع' }, { value: 'leaf', label: 'الفرعية فقط' }]} /></Field></>}
      actions={r.data && <button className="btn" onClick={() => exportCsv('ميزان المراجعة', ['الرقم', 'الحساب', 'رصيد أول المدة', 'مدين', 'دائن', 'الرصيد الختامي'], rows.map((a: any) => [a.code, a.name, formatMoney(a.opening), formatMoney(a.debit), formatMoney(a.credit), formatMoney(a.closing)]))}>تصدير</button>}
      note="الرصيد موجب = مدين، سالب = دائن. الحسابات الرئيسية تجمع أرصدة فروعها؛ الإجمالي محسوب من الحسابات الفرعية فقط."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الرقم</th><th>الحساب</th><th className="n">أول المدة</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody>
              {rows.map((a: any) => (
                <tr key={a.id} className={a.is_group ? '' : 'click'} onClick={() => !a.is_group && nav(`/reports/ledger?account=${a.id}&from=${from}&to=${to}`)}>
                  <td className="num">{a.code}</td>
                  <td style={{ paddingInlineStart: 12 + (level === 'all' ? depth(a) * 18 : 0) }} className={a.is_group ? 'bold' : ''}>{a.name}</td>
                  <td className="n">{formatMoney(a.opening)}</td>
                  <td className="n">{formatMoney(a.debit)}</td>
                  <td className="n">{formatMoney(a.credit)}</td>
                  <td className={`n ${a.is_group ? 'bold' : ''}`}>{formatMoney(a.closing)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="n">{formatMoney(r.data.totals.debit)}</td><td className="n">{formatMoney(r.data.totals.credit)}</td><td className="n">{formatMoney(r.data.totals.closing_debit)} / {formatMoney(r.data.totals.closing_credit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- دفتر الأستاذ
export function LedgerReport() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];
  const opts = useMemo(() => accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}`, search: `${a.code} ${a.name}` })), [accounts]);
  const [from, setFrom] = useState(sp.get('from') ?? yearStart());
  const [to, setTo] = useState(sp.get('to') ?? todayISO());
  const id = sp.get('account');
  const r = useRemote<any>(id ? `/api/reports/ledger/${id}?from=${from}&to=${to}` : null);
  return (
    <Shell
      title="دفتر الأستاذ"
      sub={r.data && `${r.data.account.code} — ${r.data.account.name} (${ACCOUNT_TYPE_LABEL[r.data.account.type]})`}
      error={r.error}
      loading={r.loading}
      filters={<><Field label="الحساب"><Picker value={id} options={opts} onChange={(v) => setSp(v ? { account: v } : {})} /></Field><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /></>}
      actions={r.data && <button className="btn" onClick={() => exportCsv('دفتر الأستاذ', ['التاريخ', 'القيد', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'], r.data.lines.map((l: any) => [l.date, l.entry_no, l.doc_number, l.memo ?? l.entry_memo, formatMoney(l.debit), formatMoney(l.credit), formatMoney(l.balance)]))}>تصدير</button>}
      note="للحساب الرئيسي تُعرض حركات كل فروعه. الرصيد موجب = مدين."
    >
      {!id && <div className="card pad muted">اختر حسابًا.</div>}
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>التاريخ</th><th>القيد</th><th>المستند</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="muted">رصيد أول المدة</td><td className="n bold">{formatMoney(r.data.opening)}</td></tr>
              {r.data.lines.map((l: any, i: number) => (
                <tr key={i} className={l.document_id ? 'click' : ''} onClick={() => l.document_id && nav(`/docs/view/${l.document_id}`)}>
                  <td data-label="التاريخ" className="num">{l.date}</td>
                  <td data-label="القيد" className="num">{l.entry_no}</td>
                  <td data-label="المستند" className="num">{l.doc_number}</td>
                  <td data-label="البيان">{l.memo ?? l.entry_memo}{l.party_name ? ` — ${l.party_name}` : ''}</td>
                  <td data-label="مدين" className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
                  <td data-label="دائن" className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
                  <td data-label="الرصيد" className="n bold">{formatMoney(l.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6}>الرصيد الختامي</td><td className="n">{formatMoney(r.data.closing)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- قائمة الدخل
export function IncomeReport() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/income-statement?from=${from}&to=${to}`);
  const d = r.data;
  return (
    <Shell title="قائمة الدخل" error={r.error} loading={r.loading} filters={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      note="محسوبة من القيود المرحّلة فقط. مجمل الربح = صافي المبيعات (بعد المردودات والخصم المسموح) − تكلفة البضاعة المباعة بالمتوسط المرجح. صافي الربح ليس رصيد الخزينة.">
      {d && (
        <div className="stack">
          <div className="grid grid-4">
            <Kpi label="صافي المبيعات" v={d.net_sales} />
            <Kpi label="تكلفة البضاعة المباعة" v={d.cogs} />
            <Kpi label="مجمل الربح" v={d.gross_profit} strong />
            <Kpi label="صافي الربح" v={d.net_profit} strong />
          </div>
          <Section title="الإيرادات" rows={d.revenue} total={d.total_revenue} />
          <Section title="المصروفات والتكاليف" rows={d.expenses} total={d.total_expenses} />
          <div className="card pad row"><span className="bold" style={{ flex: 1, fontSize: 20 }}>صافي الربح (الخسارة)</span><span className={`num bold ${d.net_profit < 0 ? 'red' : 'green'}`} style={{ fontSize: 22 }}>{formatMoney(d.net_profit)}</span></div>
        </div>
      )}
    </Shell>
  );
}

function Kpi({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${strong && v < 0 ? 'red' : ''}`} style={{ fontSize: strong ? 26 : 22 }}>{formatMoney(v)}</div>
    </div>
  );
}
function Section({ title, rows, total }: { title: string; rows: any[]; total: number }) {
  return (
    <div>
      <div className="group-header">{title}</div>
      <div className="list">
        {rows.length === 0 && <div className="list-row muted">لا يوجد</div>}
        {rows.map((x) => (
          <div key={x.id} className="list-row">
            <span className="num muted" style={{ width: 56 }}>{x.code}</span>
            <div className="title">{x.name}</div>
            <span className={`num ${x.net < 0 ? 'red' : ''}`}>{formatMoney(x.net)}</span>
          </div>
        ))}
        <div className="list-row"><div className="title bold">الإجمالي</div><span className="num bold">{formatMoney(total)}</span></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- الميزانية
export function BalanceSheetReport() {
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/balance-sheet?to=${to}`);
  const d = r.data;
  const block = (title: string, rows: any[], total: number, extra?: ReactNode) => (
    <div>
      <div className="group-header">{title}</div>
      <div className="list">
        {rows.map((x) => (
          <div key={x.id} className="list-row"><span className="num muted" style={{ width: 64 }}>{x.code}</span><div className="title">{x.name}</div><span className="num">{formatMoney(x.amount)}</span></div>
        ))}
        {extra}
        <div className="list-row"><div className="title bold">الإجمالي</div><span className="num bold">{formatMoney(total)}</span></div>
      </div>
    </div>
  );
  return (
    <Shell
      title="الميزانية العمومية"
      sub={d && (d.balanced ? <span className="badge green">الأصول = الخصوم + حقوق الملكية</span> : <span className="badge red">غير متوازنة</span>)}
      error={r.error}
      loading={r.loading}
      filters={<Field label="في تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
      note="أرباح الفترة غير المقفلة تظهر ضمن حقوق الملكية حتى يتم إقفال السنة المالية."
    >
      {d && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {block('الأصول', d.assets, d.total_assets)}
          <div className="stack">
            {block('الخصوم', d.liabilities, d.total_liabilities)}
            {block('حقوق الملكية', d.equity, d.total_equity, <div className="list-row"><div className="title">أرباح (خسائر) الفترة الحالية</div><span className={`num ${d.current_profit < 0 ? 'red' : ''}`}>{formatMoney(d.current_profit)}</span></div>)}
            <div className="card pad row"><span className="bold" style={{ flex: 1 }}>الخصوم + حقوق الملكية</span><span className="num bold">{formatMoney(d.total_liabilities + d.total_equity)}</span></div>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- تقارير المستندات
const REPORT_GROUPS: Record<string, { label: string; types: string[] }> = {
  sales: { label: 'المبيعات والمرتجعات', types: ['sale_invoice', 'sale_return'] },
  purchases: { label: 'المشتريات والمرتجعات', types: ['purchase_invoice', 'purchase_return'] },
  returns: { label: 'المرتجعات فقط', types: ['sale_return', 'purchase_return'] },
  treasury: { label: 'سندات الخزينة', types: ['receipt', 'payment', 'expense', 'income'] },
  inventory: { label: 'حركات المخازن', types: ['stock_transfer', 'stock_adjustment', 'opening_stock'] },
};
export function DocumentsReport() {
  const nav = useNavigate();
  const can = usePerm();
  const parties = useMap('parties');
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const whs = useWarehouses();
  const partyOpts = useMemo(() => [...parties.values()].map((p: any) => ({ id: p.id, label: p.name, sub: p.kind === 'customer' ? 'عميل' : 'مورد' })), [parties]);
  const [group, setGroup] = useState('sales');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [party, setParty] = useState<string | null>(null);
  const [user, setUser] = useState('');
  const [wh, setWh] = useState('');
  const [status, setStatus] = useState('posted');
  const url = `/api/reports/documents?from=${from}&to=${to}&types=${REPORT_GROUPS[group].types.join(',')}&party_id=${party ?? ''}&user_id=${user}&warehouse_id=${wh}&status=${status}`;
  const r = useRemote<any>(url);
  const showProfit = can('reports.profit') && group === 'sales';
  return (
    <Shell
      title="تقارير المستندات"
      sub={REPORT_GROUPS[group].label}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="التقرير">
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(REPORT_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
            </select>
          </Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="الحالة">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="posted">مرحّل</option><option value="">الكل</option><option value="draft">مسودة</option><option value="cancelled">ملغي</option><option value="pending_review">يحتاج مراجعة</option>
            </select>
          </Field>
          <Field label="العميل/المورد"><Picker value={party} options={partyOpts} onChange={setParty} allowClear placeholder="الكل" /></Field>
          <Field label="المستخدم">
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">الكل</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="المخزن">
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">الكل</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportCsv(REPORT_GROUPS[group].label, ['الرقم', 'النوع', 'التاريخ', 'الطرف', 'المستخدم', 'الحالة', 'الإجمالي', 'الضريبة', 'المدفوع'], r.data.rows.map((d: any) => [d.number, docLabel(d.doc_type), d.date, d.party_name, d.user_name, d.status, formatMoney(d.total), formatMoney(d.tax), formatMoney(d.paid)]))}>تصدير</button>}
      note={showProfit ? 'الربح = (الإجمالي − الضريبة) − تكلفة البضاعة بالمتوسط المرجح وقت البيع. المرتجعات تُطرح. الإجماليات للمستندات المرحّلة فقط.' : 'الإجماليات للمستندات المرحّلة فقط، والمرتجعات تُطرح.'}
    >
      {r.data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 14 }}>
            <Kpi label={`صافي الإجمالي (${r.data.totals.count} مستند)`} v={r.data.totals.total} />
            <Kpi label="الضريبة" v={r.data.totals.tax} />
            <Kpi label="الصافي بدون ضريبة" v={r.data.totals.net} />
            {showProfit && r.data.totals.profit != null && <Kpi label="مجمل الربح" v={r.data.totals.profit} strong />}
          </div>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>المستخدم</th><th>الحالة</th><th className="n">الإجمالي</th><th className="n">المدفوع</th>{showProfit && <th className="n">الربح</th>}</tr></thead>
              <tbody>
                {r.data.rows.map((d: any) => (
                  <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}>
                    <td data-label="الرقم" className="num bold">{d.number}</td>
                    <td data-label="النوع">{docLabel(d.doc_type)}</td>
                    <td data-label="التاريخ" className="num">{d.date}</td>
                    <td data-label="الطرف">{d.party_name}</td>
                    <td data-label="المستخدم" className="muted">{d.user_name}</td>
                    <td data-label="الحالة"><DocStatusBadge status={d.status} /></td>
                    <td data-label="الإجمالي" className="n">{formatMoney(d.total)}</td>
                    <td data-label="المدفوع" className="n">{formatMoney(d.paid)}</td>
                    {showProfit && <td data-label="الربح" className="n">{d.cost != null && d.status === 'posted' ? formatMoney((d.doc_type.endsWith('return') ? -1 : 1) * (d.total - d.tax - d.cost)) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- تحليل المبيعات/المشتريات
const GROUPS: Record<string, string> = {
  item: 'الصنف', category: 'التصنيف', party: 'العميل/المورد', rep: 'المندوب', user: 'المستخدم', warehouse: 'المخزن', day: 'اليوم', month: 'الشهر', hour: 'الساعة', weekday: 'يوم الأسبوع',
};
export function SalesAnalysisReport() {
  const can = usePerm();
  const [kind, setKind] = useState<'sales' | 'purchases'>('sales');
  const [group, setGroup] = useState('item');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/sales-analysis?kind=${kind}&group=${group}&from=${from}&to=${to}`);
  const showProfit = kind === 'sales' && can('reports.profit');
  return (
    <Shell
      title={kind === 'sales' ? 'تحليل المبيعات' : 'تحليل المشتريات'}
      sub={`حسب ${GROUPS[group]}`}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="النوع"><Segmented block value={kind} onChange={setKind} options={[{ value: 'sales', label: 'مبيعات' }, { value: 'purchases', label: 'مشتريات' }]} /></Field>
          <Field label="التجميع حسب">
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(GROUPS).filter(([k]) => kind === 'sales' || k !== 'rep').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportCsv('تحليل', [GROUPS[group], 'عدد المستندات', 'الكمية', 'الصافي', 'الخصم', ...(showProfit ? ['التكلفة', 'الربح'] : [])], r.data.rows.map((x: any) => [x.label, x.docs, formatQty(x.qty), formatMoney(x.net), formatMoney(x.discount), ...(showProfit ? [formatMoney(x.cost), formatMoney(x.profit)] : [])]))}>تصدير</button>}
      note="الصافي بدون ضريبة وبعد الخصومات، والمرتجعات تُطرح. الربح = الصافي − تكلفة البضاعة بالمتوسط المرجح وقت البيع."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>{GROUPS[group]}</th><th className="n">المستندات</th><th className="n">الكمية</th><th className="n">الصافي</th><th className="n">الخصم</th>{showProfit && <><th className="n">التكلفة</th><th className="n">الربح</th><th className="n">هامش %</th></>}<th className="n">من الإجمالي %</th></tr></thead>
            <tbody>
              {r.data.rows.map((x: any) => (
                <tr key={x.key}>
                  <td data-label={GROUPS[group]} className="bold">{x.label}</td>
                  <td data-label="المستندات" className="n">{x.docs}</td>
                  <td data-label="الكمية" className="n">{formatQty(x.qty)}</td>
                  <td data-label="الصافي" className="n">{formatMoney(x.net)}</td>
                  <td data-label="الخصم" className="n">{formatMoney(x.discount)}</td>
                  {showProfit && <><td data-label="التكلفة" className="n">{formatMoney(x.cost)}</td><td data-label="الربح" className={`n bold ${x.profit < 0 ? 'red' : ''}`}>{formatMoney(x.profit)}</td><td data-label="هامش" className="n">{x.net ? ((x.profit * 100) / x.net).toFixed(1) : '0'}%</td></>}
                  <td data-label="النسبة" className="n">{(x.share_bp / 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>الإجمالي</td><td /><td className="n">{formatQty(r.data.totals.qty)}</td><td className="n">{formatMoney(r.data.totals.net)}</td><td />{showProfit && <><td className="n">{formatMoney(r.data.totals.cost)}</td><td className="n">{formatMoney(r.data.totals.net - r.data.totals.cost)}</td><td /></>}<td /></tr></tfoot>
          </table>
        </div>
      )}
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
      actions={r.data && <button className="btn" onClick={() => exportCsv('الصلاحية', ['الصنف', 'المخزن', 'تاريخ الانتهاء', 'الأيام المتبقية', 'الكمية'], r.data.rows.map((x: any) => [x.name, x.warehouse_name, x.expiry, x.days_left, formatQty(x.qty)]))}>تصدير</button>}
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

// ---------------------------------------------------------------- تحليل المقبوضات والمصروفات
const T_GROUPS: Record<string, string> = { item: 'البند', type: 'نوع المستند', party: 'الطرف', cashbox: 'الخزينة', user: 'المستخدم', day: 'اليوم', month: 'الشهر' };
const tLabel = (group: string, label: string) => (group === 'item' || group === 'type' ? (label === 'jv' ? 'قيد يومية' : DOC_TYPES[label as DocType]?.label ?? label) : label);
export function TreasuryAnalysisReport() {
  const [sp] = useSearchParams();
  const [dir, setDir] = useState<'in' | 'out'>(sp.get('dir') === 'out' ? 'out' : 'in');
  useEffect(() => setDir(sp.get('dir') === 'out' ? 'out' : 'in'), [sp]);
  const [group, setGroup] = useState('item');
  const [box, setBox] = useState('');
  const [user, setUser] = useState('');
  const [internal, setInternal] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const boxes = useLiveQuery(() => db.cashboxes.toArray(), []) ?? [];
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const r = useRemote<any>(`/api/reports/treasury-analysis?dir=${dir}&group=${group}&from=${from}&to=${to}&cashbox_id=${box}&user_id=${user}&internal=${internal ? 1 : 0}`);
  const title = dir === 'in' ? 'تحليل المقبوضات' : 'تحليل المصروفات والمدفوعات';
  return (
    <Shell
      title={title}
      sub={r.data ? `حسب ${T_GROUPS[group]} · الإجمالي ${formatMoney(r.data.total)}` : `حسب ${T_GROUPS[group]}`}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="النوع"><Segmented block value={dir} onChange={setDir} options={[{ value: 'in', label: 'مقبوضات' }, { value: 'out', label: 'مدفوعات' }]} /></Field>
          <Field label="التجميع حسب">
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(T_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="الخزينة">
            <select className="select" value={box} onChange={(e) => setBox(e.target.value)}>
              <option value="">كل الخزائن والبنوك</option>
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="المستخدم">
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">كل المستخدمين</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="التحويلات بين الخزائن"><Segmented block value={internal ? '1' : '0'} onChange={(v) => setInternal(v === '1')} options={[{ value: '0', label: 'مستبعدة' }, { value: '1', label: 'مضمنة' }]} /></Field>
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportCsv(title, [T_GROUPS[group], 'عدد الحركات', 'المبلغ', 'النسبة %'], r.data.rows.map((x: any) => [tLabel(group, x.label), x.count, formatMoney(x.amount), (x.share_bp / 100).toFixed(1)]))}>تصدير</button>}
      note="محسوب من الحركة الفعلية على الخزائن والبنوك (نقدي)، وليس من الفواتير الآجلة. المستندات الملغاة مستبعدة. التحويل بين الخزائن نقل داخلي ولا يُحسب مقبوضًا أو مصروفًا إلا إذا اخترت تضمينه."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>{T_GROUPS[group]}</th><th className="n">الحركات</th><th className="n">المبلغ</th><th className="n">من الإجمالي %</th></tr></thead>
            <tbody>
              {r.data.rows.length === 0 && <tr><td colSpan={4} className="muted">لا توجد حركات في الفترة</td></tr>}
              {r.data.rows.map((x: any) => (
                <tr key={x.key}>
                  <td data-label={T_GROUPS[group]} className="bold">{tLabel(group, x.label)}</td>
                  <td data-label="الحركات" className="n">{x.count}</td>
                  <td data-label="المبلغ" className={`n bold ${dir === 'in' ? 'green' : 'red'}`}>{formatMoney(x.amount)}</td>
                  <td data-label="النسبة" className="n">
                    <span className="share-bar"><i style={{ width: `${Math.min(100, x.share_bp / 100)}%` }} /></span> {(x.share_bp / 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>الإجمالي</td><td /><td className="n">{formatMoney(r.data.total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- الحركة اليومية
export function DailyMovementReport() {
  const nav = useNavigate();
  const can = usePerm();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [user, setUser] = useState('');
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const r = useRemote<any>(`/api/reports/daily?from=${from}&to=${to}&user_id=${user}`);
  const d = r.data;
  const sumIn = d?.cashboxes.reduce((s: number, b: any) => s + b.cash_in, 0) ?? 0;
  const sumOut = d?.cashboxes.reduce((s: number, b: any) => s + b.cash_out, 0) ?? 0;
  return (
    <Shell
      title="الحركة اليومية"
      sub={from === to ? from : `${from} ← ${to}`}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="المستخدم">
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">كل المستخدمين</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </>
      }
      actions={d && <button className="btn" onClick={() => exportCsv(`الحركة اليومية ${from}`, ['الوقت', 'المستند', 'النوع', 'الطرف', 'المستخدم', 'الإجمالي', 'المدفوع', 'المتبقي'], d.docs.map((x: any) => [new Date(x.created_at).toLocaleString('ar-EG'), x.number ?? x.local_number, docLabel(x.doc_type), x.party_name ?? '', x.user_name ?? '', formatMoney(x.total), formatMoney(x.paid), ['sale_invoice', 'purchase_invoice'].includes(x.doc_type) ? formatMoney(x.total - x.paid) : '']))}>تصدير</button>}
      note="المستندات المرحّلة وتحت المراجعة في الفترة (بدون عروض الأسعار والملغاة). حركة الخزائن من القيود الفعلية؛ الرصيد الختامي يشمل كل الحركات حتى لو اخترت مستخدمًا."
    >
      {d && (
        <div className="stack">
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>نوع المستند</th><th className="n">العدد</th><th className="n">الإجمالي</th><th className="n">المدفوع/المحصّل</th><th className="n">المتبقي (آجل)</th></tr></thead>
              <tbody>
                {d.by_type.length === 0 && <tr><td colSpan={5} className="muted">لا توجد مستندات</td></tr>}
                {d.by_type.map((t: any) => (
                  <tr key={t.doc_type}>
                    <td data-label="النوع" className="bold">{docLabel(t.doc_type)}</td>
                    <td data-label="العدد" className="n">{t.count}</td>
                    <td data-label="الإجمالي" className="n">{formatMoney(t.total)}</td>
                    <td data-label="المدفوع" className="n">{formatMoney(t.paid)}</td>
                    <td data-label="المتبقي" className={`n ${t.remaining ? 'orange' : 'muted'}`}>{t.remaining ? formatMoney(t.remaining) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('treasury.view') && d.cashboxes.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>الخزينة</th><th className="n">رصيد أول الفترة</th><th className="n">مقبوضات</th><th className="n">مدفوعات</th><th className="n">الرصيد آخر الفترة</th></tr></thead>
                <tbody>
                  {d.cashboxes.map((b: any) => (
                    <tr key={b.id}>
                      <td data-label="الخزينة" className="bold">{b.name}</td>
                      <td data-label="أول الفترة" className="n">{formatMoney(b.opening)}</td>
                      <td data-label="مقبوضات" className="n green">{formatMoney(b.cash_in)}</td>
                      <td data-label="مدفوعات" className="n red">{formatMoney(b.cash_out)}</td>
                      <td data-label="آخر الفترة" className="n bold">{formatMoney(b.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>الإجمالي</td><td className="n">{formatMoney(d.cashboxes.reduce((s: number, b: any) => s + b.opening, 0))}</td><td className="n">{formatMoney(sumIn)}</td><td className="n">{formatMoney(sumOut)}</td><td className="n">{formatMoney(d.cashboxes.reduce((s: number, b: any) => s + b.closing, 0))}</td></tr></tfoot>
              </table>
            </div>
          )}
          <div className="section-title" style={{ margin: '6px 0 0' }}>المستندات ({d.docs.length})</div>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الوقت</th><th>المستند</th><th>النوع</th><th>الطرف</th><th>المستخدم</th><th className="n">الإجمالي</th><th className="n">المدفوع</th><th className="n">المتبقي</th></tr></thead>
              <tbody>
                {d.docs.map((x: any) => (
                  <tr key={x.id} className="click" onClick={() => nav(`/docs/view/${x.id}`)}>
                    <td data-label="الوقت" className="num">{new Date(x.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}{from !== to ? ` · ${x.date}` : ''}</td>
                    <td data-label="المستند" className="num">{x.number ?? x.local_number} {x.status === 'pending_review' && <span className="badge orange">مراجعة</span>}</td>
                    <td data-label="النوع">{docLabel(x.doc_type)}</td>
                    <td data-label="الطرف">{x.party_name ?? ''}</td>
                    <td data-label="المستخدم" className="muted">{x.user_name ?? ''}</td>
                    <td data-label="الإجمالي" className="n">{formatMoney(x.total)}</td>
                    <td data-label="المدفوع" className="n">{formatMoney(x.paid)}</td>
                    <td data-label="المتبقي" className="n">{['sale_invoice', 'purchase_invoice'].includes(x.doc_type) && x.total - x.paid ? formatMoney(x.total - x.paid) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      actions={rows.length > 0 && <button className="btn" onClick={() => exportCsv('أرصدة سالبة', ['الكود', 'الصنف', 'المخزن', 'الرصيد', 'الوحدة'], rows.map((r: any) => [r.item.code, r.item.name, r.warehouse_name, formatQty(r.qty), r.item.base_unit]))}>تصدير</button>}
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
