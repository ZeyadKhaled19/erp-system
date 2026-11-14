/** تقارير المستندات وتحليل المبيعات */
import { formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocStatusBadge, exportExcel, Field, Picker, Segmented } from '../../components/ui';
import { db } from '../../lib/db';
import { useMap, usePerm, useRemote } from '../../lib/hooks';
import { monthStart, docLabel, Shell, DateRange, useWarehouses, Kpi } from './shared';

// ---------------------------------------------------------------- تقارير المستندات
const REPORT_GROUPS: Record<string, { label: string; types: string[] }> = {
  sales: { label: 'المبيعات والمرتجعات', types: ['sale_invoice', 'sale_return'] },
  purchases: { label: 'المشتريات والمرتجعات', types: ['purchase_invoice', 'purchase_return'] },
  returns: { label: 'المرتجعات فقط', types: ['sale_return', 'purchase_return'] },
  treasury: { label: 'سندات الخزينة', types: ['receipt', 'payment', 'expense', 'income'] },
  inventory: { label: 'حركات المخازن', types: ['stock_transfer', 'stock_adjustment', 'opening_stock'] },
};

// ---------------------------------------------------------------- تحليل المبيعات/المشتريات
const GROUPS: Record<string, string> = {
  item: 'الصنف', category: 'التصنيف', party: 'العميل/المورد', rep: 'المندوب', user: 'المستخدم', warehouse: 'المخزن', day: 'اليوم', month: 'الشهر', hour: 'الساعة', weekday: 'يوم الأسبوع',
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
      actions={r.data && <button className="btn" onClick={() => exportExcel(REPORT_GROUPS[group].label, ['الرقم', 'النوع', 'التاريخ', 'الطرف', 'المستخدم', 'الحالة', 'الإجمالي', 'الضريبة', 'المدفوع'], r.data.rows.map((d: any) => [d.number, docLabel(d.doc_type), d.date, d.party_name, d.user_name, d.status, formatMoney(d.total), formatMoney(d.tax), formatMoney(d.paid)]))}>تصدير Excel</button>}
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
      actions={r.data && <button className="btn" onClick={() => exportExcel('تحليل', [GROUPS[group], 'عدد المستندات', 'الكمية', 'الصافي', 'الخصم', ...(showProfit ? ['التكلفة', 'الربح'] : [])], r.data.rows.map((x: any) => [x.label, x.docs, formatQty(x.qty), formatMoney(x.net), formatMoney(x.discount), ...(showProfit ? [formatMoney(x.cost), formatMoney(x.profit)] : [])]))}>تصدير Excel</button>}
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
