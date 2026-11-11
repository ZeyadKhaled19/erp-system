import { ACCOUNT_TYPE_LABEL, DOC_TYPES, formatMoney, formatQty, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DocStatusBadge, exportCsv, Field, Picker, Segmented } from '../components/ui';
import { db } from '../lib/db';
import { useMap, usePerm, useRemote, useSettings } from '../lib/hooks';

const monthStart = () => `${todayISO().slice(0, 7)}-01`;
const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;

function Shell({ title, sub, filters, actions, error, loading, children, note }: { title: string; sub?: ReactNode; filters?: ReactNode; actions?: ReactNode; error?: string | null; loading?: boolean; children: ReactNode; note?: ReactNode }) {
  const settings = useSettings();
  return (
    <div className="page">
      <div className="print-only" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{settings.company_name}</div>
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
  return useLiveQuery(async () => (await db.items.orderBy('code').toArray()).map((i) => ({ id: i.id, label: i.name, sub: i.code, search: `${i.name} ${i.code} ${i.barcode ?? ''}` })), []) ?? [];
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
  // التقرير محلي بالكامل (من آخر مزامنة) ليعمل دون اتصال
  const data = useLiveQuery(async () => {
    const items = await db.items.orderBy('code').toArray();
    const bal = await db.stock_balances.toArray();
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c.name]));
    const rows = items.map((i: any) => {
      const b = bal.filter((x) => x.item_id === i.id && (!wh || x.warehouse_id === wh));
      return { ...i, qty: b.reduce((s, x) => s + x.qty, 0), value: b.reduce((s, x) => s + x.value, 0), cat: cats.get(i.category_id) };
    });
    return rows.filter((r) => !nonzero || r.qty !== 0);
  }, [wh, nonzero]) ?? [];
  const total = data.reduce((s, r) => s + r.value, 0);
  return (
    <Shell
      title="تقرير بضاعة مخزن"
      sub={`${data.length} صنف${can('costs.view') ? ` · القيمة بالتكلفة ${formatMoney(total)}` : ''}`}
      filters={
        <>
          <Field label="المخزن">
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">كل المخازن</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="العرض"><Segmented block value={nonzero ? '1' : '0'} onChange={(v) => setNonzero(v === '1')} options={[{ value: '1', label: 'الأصناف ذات الرصيد' }, { value: '0', label: 'كل الأصناف' }]} /></Field>
        </>
      }
      actions={<button className="btn" onClick={() => exportCsv('بضاعة مخزن', ['الكود', 'الصنف', 'التصنيف', 'الوحدة', 'الكمية', ...(can('costs.view') ? ['متوسط التكلفة', 'القيمة'] : [])], data.map((r) => [r.code, r.name, r.cat, r.base_unit, formatQty(r.qty), ...(can('costs.view') ? [r.qty ? formatMoney(Math.round((r.value * 1000) / r.qty)) : '', formatMoney(r.value)] : [])]))}>تصدير</button>}
      note="القيمة = مجموع تكلفة الكميات المتبقية بطريقة المتوسط المرجح لكل مخزن. الأرصدة حسب آخر مزامنة."
    >
      <div className="table-wrap">
        <table className="table responsive">
          <thead><tr><th>الكود</th><th>الصنف</th><th>التصنيف</th><th>الوحدة</th><th className="n">الكمية</th>{can('costs.view') && <><th className="n">متوسط التكلفة</th><th className="n">القيمة</th></>}</tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/reports/item?id=${r.id}`)}>
                <td data-label="الكود" className="num">{r.code}</td>
                <td data-label="الصنف" className="bold">{r.name}</td>
                <td data-label="التصنيف" className="muted">{r.cat ?? ''}</td>
                <td data-label="الوحدة">{r.base_unit}</td>
                <td data-label="الكمية" className={`n bold ${r.qty < 0 ? 'red' : ''}`}>{formatQty(r.qty)}</td>
                {can('costs.view') && <><td data-label="متوسط التكلفة" className="n">{r.qty > 0 ? formatMoney(Math.round((r.value * 1000) / r.qty)) : ''}</td><td data-label="القيمة" className="n">{formatMoney(r.value)}</td></>}
              </tr>
            ))}
          </tbody>
          {can('costs.view') && <tfoot><tr><td colSpan={6}>الإجمالي</td><td className="n">{formatMoney(total)}</td></tr></tfoot>}
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
  const data = useLiveQuery(async () => {
    const items = (await db.items.toArray()).filter((i) => i.active !== false && i.reorder_level > 0);
    const bal = await db.stock_balances.toArray();
    return items
      .map((i: any) => ({ ...i, qty: bal.filter((b) => b.item_id === i.id).reduce((s, b) => s + b.qty, 0) }))
      .filter((i) => i.qty <= i.reorder_level)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, []) ?? [];
  return (
    <Shell
      title="الأصناف تحت حد الطلب"
      sub={`${data.length} صنف وصل لحد إعادة الطلب أو أقل`}
      actions={<button className="btn" onClick={() => exportCsv('النواقص', ['الكود', 'الصنف', 'الرصيد', 'حد الطلب', 'العجز'], data.map((r) => [r.code, r.name, formatQty(r.qty), formatQty(r.reorder_level), formatQty(r.reorder_level - r.qty)]))}>تصدير</button>}
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
          <div className="card pad row"><span className="bold" style={{ flex: 1, fontSize: 20 }}>صافي الربح (الخسارة)</span><span className={`num bold ${d.net_profit < 0 ? 'red' : 'green'}`} style={{ fontSize: 24 }}>{formatMoney(d.net_profit)}</span></div>
        </div>
      )}
    </Shell>
  );
}

function Kpi({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${strong && v < 0 ? 'red' : ''}`} style={{ textAlign: 'start', fontSize: strong ? 26 : 22 }}>{formatMoney(v)}</div>
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
