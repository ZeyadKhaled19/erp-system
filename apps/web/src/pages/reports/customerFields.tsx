/** تقرير العملاء حسب خانة حرة (ماركة، موديل، نوع...): عدد العملاء ومبيعاتهم ومستحقاتهم لكل اختيار */
import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hint } from '../../components/Hint';
import { exportExcel } from '../../components/ui';
import { customOf, usePartyFields } from '../../components/PartyFields';
import { db } from '../../lib/db';
import { usePerm } from '../../lib/hooks';
import { DateRange, monthStart, Shell } from './shared';

interface Row { id: string; name: string; active: boolean; customers: number; invoices: number; sales: number; balance: number }

export function CustomerFieldsReport() {
  const nav = useNavigate();
  const can = usePerm();
  const showSales = can('sales.view');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const fields = usePartyFields('customer', true);
  const [fieldId, setFieldId] = useState(() => new URLSearchParams(window.location.search).get('field') ?? '');
  const field = fields.find((f) => f.id === fieldId) ?? fields.find((f) => f.active !== false) ?? fields[0];

  const data = useLiveQuery(async () => {
    if (!field) return { list: [] as Row[], totalCustomers: 0, branded: 0, brands: 0 };
    const customers = (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.id !== 'party-cash-customer');
    // للقوائم المفتاح = id الاختيار، وللكلام الحر المفتاح = النص نفسه
    const keyOf = (p: any) => String(customOf(p)[field.id] ?? '').trim();
    const brandOf = new Map(customers.map((p) => [p.id, keyOf(p)]));
    const brands = field.kind === 'list' ? field.options : [...new Set(customers.map(keyOf).filter(Boolean))].map((v) => ({ id: v, name: v, active: true }));
    const rows = new Map<string, Row>();
    const row = (id: string, name: string, active = true) => {
      if (!rows.has(id)) rows.set(id, { id, name, active, customers: 0, invoices: 0, sales: 0, balance: 0 });
      return rows.get(id)!;
    };
    brands.forEach((b) => row(b.id, b.name, b.active !== false));
    const none = `من غير ${field.name}`;
    for (const p of customers) {
      const k = keyOf(p);
      const r = k && rows.has(k) ? rows.get(k)! : row('', none);
      r.customers++;
      r.balance += p.balance ?? 0;
    }
    if (showSales) {
      const docs = (await db.documents.where('date').between(from, to, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return') && brandOf.has(d.party_id));
      for (const d of docs) {
        const b = brandOf.get(d.party_id) ?? '';
        const r = b && rows.has(b) ? rows.get(b)! : row('', none);
        if (d.doc_type === 'sale_invoice') { r.sales += d.total ?? 0; r.invoices++; }
        else r.sales -= d.total ?? 0;
      }
    }
    const list = [...rows.values()].sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.customers - a.customers || b.sales - a.sales));
    return { list, totalCustomers: customers.length, branded: customers.filter((p) => keyOf(p) && rows.has(keyOf(p))).length, brands: brands.length };
  }, [from, to, showSales, field]);

  const list = data?.list ?? [];
  const pct = (n: number) => (data?.totalCustomers ? Math.round((n * 100) / data.totalCustomers) : 0);
  const totals = list.reduce((s, r) => ({ customers: s.customers + r.customers, invoices: s.invoices + r.invoices, sales: s.sales + r.sales, balance: s.balance + r.balance }), { customers: 0, invoices: 0, sales: 0, balance: 0 });

  return (
    <Shell
      title={field ? `العملاء حسب ${field.name}` : 'العملاء حسب خانة'}
      sub={field ? `${data?.brands ?? 0} اختيار · ${data?.branded ?? 0} من ${data?.totalCustomers ?? 0} عميل متسجل لهم ${field.name}` : undefined}
      filters={<>
        {fields.length > 1 && (
          <select className="select" style={{ width: 200 }} value={field?.id ?? ''} onChange={(e) => setFieldId(e.target.value)} aria-label="الخانة">
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}{f.active === false ? ' (موقوفة)' : ''}</option>)}
          </select>
        )}
        {showSales && <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      </>}
      actions={list.length > 0 && (
        <button className="btn" onClick={() => exportExcel(`العملاء حسب ${field?.name ?? ''}`, [field?.name ?? 'الاختيار', 'عدد العملاء', 'النسبة %', ...(showSales ? ['عدد الفواتير', 'صافي المبيعات'] : []), 'المستحق على العملاء'],
          list.map((r) => [r.name, r.customers, pct(r.customers), ...(showSales ? [r.invoices, formatMoney(r.sales)] : []), formatMoney(r.balance)]))}>تصدير Excel</button>
      )}
      note="العميل النقدي مش محسوب. المبيعات = فواتير البيع المرحّلة في الفترة ناقص المرتجعات، شامل الضريبة. المستحق = رصيد العملاء الحالي (مش مرتبط بالفترة). دوس على أي صف يفتح عملاءه."
    >
      {!field ? (
        <div className="card pad muted">لسه مفيش خانات لبيانات العملاء. ضيفها من «العملاء ← خانات بيانات العملاء» (مثلًا: الماركة أو الموديل).</div>
      ) : data && list.length === 0 ? (
        <div className="card pad muted">لسه مفيش عملاء.</div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>{field?.name}</th>
                <th className="n">عدد العملاء <Hint side="start" text="العملاء المتسجل لهم الاختيار ده في بياناتهم (من غير العميل النقدي)." /></th>
                <th className="n">النسبة</th>
                {showSales && <th className="n">عدد الفواتير</th>}
                {showSales && <th className="n">صافي المبيعات <Hint side="start" text="مبيعات العملاء دول في الفترة المختارة: الفواتير المرحّلة ناقص المرتجعات." /></th>}
                <th className="n">المستحق على العملاء <Hint side="start" text="مجموع أرصدة العملاء دول دلوقتي (اللي عليهم ناقص اللي ليهم)." /></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id || 'none'} className="click" onClick={() => field?.kind === 'list' && nav(`/parties/customer?field=${encodeURIComponent(`${field.id}:${r.id || '__none'}`)}`)}>
                  <td data-label={field?.name} className="bold">
                    {r.id ? r.name : <span className="muted">{r.name}</span>}
                    {!r.active && <span className="badge red" style={{ marginInlineStart: 8 }}>موقوف</span>}
                  </td>
                  <td data-label="عدد العملاء" className="n">{r.customers}</td>
                  <td data-label="النسبة" className="n">
                    <span className="brand-bar" aria-hidden="true"><i style={{ width: `${pct(r.customers)}%` }} /></span> {pct(r.customers)}%
                  </td>
                  {showSales && <td data-label="عدد الفواتير" className="n">{r.invoices}</td>}
                  {showSales && <td data-label="صافي المبيعات" className="n">{formatMoney(r.sales)}</td>}
                  <td data-label="المستحق على العملاء" className={`n ${r.balance > 0 ? 'orange' : ''}`}>{formatMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr>
                  <td>الإجمالي</td>
                  <td className="n">{totals.customers}</td>
                  <td />
                  {showSales && <td className="n">{totals.invoices}</td>}
                  {showSales && <td className="n">{formatMoney(totals.sales)}</td>}
                  <td className="n">{formatMoney(totals.balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Shell>
  );
}
