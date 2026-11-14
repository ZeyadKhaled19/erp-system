/** تقرير العملاء حسب ماركة السكوتر: عدد العملاء ومبيعاتهم ومستحقاتهم لكل ماركة */
import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bike } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hint } from '../../components/Hint';
import { exportExcel } from '../../components/ui';
import { db } from '../../lib/db';
import { usePerm } from '../../lib/hooks';
import { DateRange, monthStart, Shell } from './shared';

interface Row { id: string; name: string; active: boolean; customers: number; invoices: number; sales: number; balance: number }

export function ScooterBrandsReport() {
  const nav = useNavigate();
  const can = usePerm();
  const showSales = can('sales.view');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());

  const data = useLiveQuery(async () => {
    const brands = (await db.scooter_brands.toArray()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const customers = (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.id !== 'party-cash-customer');
    const brandOf = new Map(customers.map((p) => [p.id, p.scooter_brand_id ?? '']));
    const rows = new Map<string, Row>();
    const row = (id: string, name: string, active = true) => {
      if (!rows.has(id)) rows.set(id, { id, name, active, customers: 0, invoices: 0, sales: 0, balance: 0 });
      return rows.get(id)!;
    };
    brands.forEach((b) => row(b.id, b.name, b.active !== false));
    for (const p of customers) {
      const r = p.scooter_brand_id && rows.has(p.scooter_brand_id) ? rows.get(p.scooter_brand_id)! : row('', 'من غير ماركة');
      r.customers++;
      r.balance += p.balance ?? 0;
    }
    if (showSales) {
      const docs = (await db.documents.where('date').between(from, to, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return') && brandOf.has(d.party_id));
      for (const d of docs) {
        const b = brandOf.get(d.party_id) ?? '';
        const r = b && rows.has(b) ? rows.get(b)! : row('', 'من غير ماركة');
        if (d.doc_type === 'sale_invoice') { r.sales += d.total ?? 0; r.invoices++; }
        else r.sales -= d.total ?? 0;
      }
    }
    const list = [...rows.values()].sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.customers - a.customers || b.sales - a.sales));
    return { list, totalCustomers: customers.length, branded: customers.filter((p) => p.scooter_brand_id && rows.has(p.scooter_brand_id)).length, brands: brands.length };
  }, [from, to, showSales]);

  const list = data?.list ?? [];
  const pct = (n: number) => (data?.totalCustomers ? Math.round((n * 100) / data.totalCustomers) : 0);
  const totals = list.reduce((s, r) => ({ customers: s.customers + r.customers, invoices: s.invoices + r.invoices, sales: s.sales + r.sales, balance: s.balance + r.balance }), { customers: 0, invoices: 0, sales: 0, balance: 0 });

  return (
    <Shell
      title="العملاء حسب ماركة السكوتر"
      sub={`${data?.brands ?? 0} ماركة · ${data?.branded ?? 0} من ${data?.totalCustomers ?? 0} عميل متحدد لهم ماركة`}
      filters={showSales ? <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /> : undefined}
      actions={list.length > 0 && (
        <button className="btn" onClick={() => exportExcel('ماركات السكوتر', ['الماركة', 'عدد العملاء', 'النسبة %', ...(showSales ? ['عدد الفواتير', 'صافي المبيعات'] : []), 'المستحق على العملاء'],
          list.map((r) => [r.name, r.customers, pct(r.customers), ...(showSales ? [r.invoices, formatMoney(r.sales)] : []), formatMoney(r.balance)]))}>تصدير Excel</button>
      )}
      note="العميل النقدي مش محسوب. المبيعات = فواتير البيع المرحّلة في الفترة ناقص المرتجعات، شامل الضريبة. المستحق = رصيد العملاء الحالي (مش مرتبط بالفترة). دوس على أي ماركة يفتح عملاءها."
    >
      {data && list.length === 0 ? (
        <div className="card pad muted">لسه مفيش ماركات ولا عملاء. ضيف الماركات من «العملاء ← إدارة ماركات السكوتر».</div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>الماركة</th>
                <th className="n">عدد العملاء <Hint side="start" text="العملاء المتسجل لهم الماركة دي في بياناتهم (من غير العميل النقدي)." /></th>
                <th className="n">النسبة</th>
                {showSales && <th className="n">عدد الفواتير</th>}
                {showSales && <th className="n">صافي المبيعات <Hint side="start" text="مبيعات عملاء الماركة دي في الفترة المختارة: الفواتير المرحّلة ناقص المرتجعات." /></th>}
                <th className="n">المستحق على العملاء <Hint side="start" text="مجموع أرصدة عملاء الماركة دي دلوقتي (اللي عليهم ناقص اللي ليهم)." /></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id || 'none'} className="click" onClick={() => nav(`/parties/customer?brand=${r.id || '__none'}`)}>
                  <td data-label="الماركة" className="bold">
                    <Bike style={{ width: 16, height: 16, verticalAlign: -3, marginInlineEnd: 8 }} aria-hidden="true" />
                    {r.id ? r.name : <span className="muted">من غير ماركة</span>}
                    {!r.active && <span className="badge red" style={{ marginInlineStart: 8 }}>موقوفة</span>}
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
