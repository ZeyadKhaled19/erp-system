import { formatMoney, todayISO, uuid } from '@erp/shared';
import { Lock, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, exportCsv, Field, useUi } from '../components/ui';
import { db } from '../lib/db';
import { usePerm, useRemote } from '../lib/hooks';
import { enqueue } from '../lib/sync';

/** عمولات المندوبين: صافي مبيعات كل مندوب × نسبته، والمصروف منها، وزر صرف المستحق */
export function CommissionsPage() {
  const nav = useNavigate();
  const can = usePerm();
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/commissions?from=${from}&to=${to}`);
  return (
    <div className="page">
      <PageHeader
        title="عمولات المندوبين"
        sub="العمولة = صافي المبيعات بدون ضريبة بعد خصم المرتجعات × نسبة المندوب"
        actions={r.data && <button className="btn" onClick={() => exportCsv('عمولات المندوبين', ['المندوب', 'الفواتير', 'صافي المبيعات', 'النسبة %', 'العمولة', 'المصروف', 'المستحق'], r.data.rows.map((x: any) => [x.name, x.invoices, formatMoney(x.net), x.commission_bp / 100, formatMoney(x.commission), formatMoney(x.paid), formatMoney(x.due)]))}>تصدير</button>}
      />
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="grid grid-4" style={{ alignItems: 'end' }}>
          <Field label="من تاريخ"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="إلى تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
      {r.error && <Banner kind="warn">{r.error}</Banner>}
      {r.data && (
        <>
          <div className="kpis" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="k-label">صافي مبيعات المندوبين</div><div className="k-value num" style={{ textAlign: 'start' }}>{formatMoney(r.data.totals.net)}</div></div>
            <div className="kpi"><div className="k-label">إجمالي العمولات</div><div className="k-value num" style={{ textAlign: 'start' }}>{formatMoney(r.data.totals.commission)}</div></div>
            <div className="kpi"><div className="k-label">المصروف</div><div className="k-value num" style={{ textAlign: 'start' }}>{formatMoney(r.data.totals.paid)}</div></div>
            <div className="kpi"><div className="k-label">المستحق</div><div className={`k-value num ${r.data.totals.due > 0 ? 'orange' : ''}`} style={{ textAlign: 'start' }}>{formatMoney(r.data.totals.due)}</div></div>
          </div>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>المندوب</th><th className="n">فواتير</th><th className="n">المبيعات</th><th className="n">المرتجعات</th><th className="n">الصافي</th><th className="n">النسبة</th><th className="n">العمولة</th><th className="n">المصروف</th><th className="n">المستحق</th><th /></tr></thead>
              <tbody>
                {r.data.rows.length === 0 && <tr><td colSpan={10} className="muted">لا يوجد مندوبون. أضفهم من «قوائم الأسعار والمندوبون» واختر المندوب في الفاتورة من «خيارات إضافية».</td></tr>}
                {r.data.rows.map((x: any) => (
                  <tr key={x.id}>
                    <td data-label="المندوب" className="bold">{x.name}</td>
                    <td data-label="فواتير" className="n">{x.invoices}</td>
                    <td data-label="المبيعات" className="n">{formatMoney(x.sales)}</td>
                    <td data-label="المرتجعات" className="n">{formatMoney(x.returns)}</td>
                    <td data-label="الصافي" className="n bold">{formatMoney(x.net)}</td>
                    <td data-label="النسبة" className="n">{x.commission_bp / 100}%</td>
                    <td data-label="العمولة" className="n">{formatMoney(x.commission)}</td>
                    <td data-label="المصروف" className="n">{formatMoney(x.paid)}</td>
                    <td data-label="المستحق" className={`n bold ${x.due > 0 ? 'orange' : ''}`}>{formatMoney(x.due)}</td>
                    <td data-label="">
                      {x.due > 0 && can('treasury.create') && (
                        <button className="btn sm primary" onClick={() => nav(`/docs/new/expense?account=acc-5208&amount=${x.due}&rep=${x.id}&note=${encodeURIComponent(`عمولة ${x.name} عن ${from} إلى ${to}`)}`)}>
                          <Wallet /> صرف
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** إقفال السنة المالية: نقل صافي الربح للأرباح المحتجزة وقفل الفترة */
export function YearEndPage() {
  const ui = useUi();
  const can = usePerm();
  const lastYear = String(Number(todayISO().slice(0, 4)) - 1);
  const [date, setDate] = useState(`${lastYear}-12-31`);
  const r = useRemote<any>(`/api/reports/closing-preview?to=${date}`);
  const [busy, setBusy] = useState(false);
  const d = r.data;
  const close = async () => {
    const ok = await ui.confirm({
      title: `إقفال الفترة حتى ${date}؟`,
      message: `سيُنقل صافي ${d.net_profit >= 0 ? 'الربح' : 'الخسارة'} (${formatMoney(Math.abs(d.net_profit))}) إلى الأرباح المحتجزة، وتُقفل كل المستندات حتى ${date} فلا يمكن تعديلها أو إضافة مستندات بتاريخ قبلها. التقارير القديمة تبقى كما هي.`,
      confirmLabel: 'إقفال',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const id = uuid();
    await enqueue({ type: 'year.close', id, date }, { label: `إقفال الفترة حتى ${date}`, entity: 'document', entity_id: id });
    ui.toast('سيُنفذ الإقفال عند المزامنة');
    setBusy(false);
    void db;
  };
  return (
    <div className="page narrow">
      <PageHeader title="إقفال السنة المالية" sub="نقل نتيجة الفترة إلى الأرباح المحتجزة وقفلها" />
      <div className="card pad stack">
        <Field label="إقفال حتى تاريخ"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {r.error && <Banner kind="warn">{r.error}</Banner>}
        {d && (
          <>
            <div className="list" style={{ background: 'var(--card-2)' }}>
              <div className="list-row" style={{ background: 'transparent' }}><div className="title">الفترة</div><span className="num">{d.from ?? 'من البداية'} ← {d.to}</span></div>
              {d.last_closing && <div className="list-row" style={{ background: 'transparent' }}><div className="title">آخر إقفال</div><span className="num">{d.last_closing}</span></div>}
              <div className="list-row" style={{ background: 'transparent' }}><div className="title">الإيرادات</div><span className="num">{formatMoney(d.revenue)}</span></div>
              <div className="list-row" style={{ background: 'transparent' }}><div className="title">المصروفات والتكاليف</div><span className="num">{formatMoney(d.expenses)}</span></div>
              <div className="list-row" style={{ background: 'transparent' }}><div className="title bold">صافي {d.net_profit >= 0 ? 'الربح' : 'الخسارة'}</div><span className={`num bold ${d.net_profit < 0 ? 'red' : 'green'}`}>{formatMoney(d.net_profit)}</span></div>
              {d.distributions > 0 && <div className="list-row" style={{ background: 'transparent' }}><div className="title">توزيعات أرباح معلنة تُقفل أيضًا</div><span className="num">{formatMoney(d.distributions)}</span></div>}
            </div>
            {d.locked_until && <Banner kind="info">الفترة مقفلة حاليًا حتى {d.locked_until}.</Banner>}
            <Banner kind="warn">قبل الإقفال: تأكد من ترحيل كل الفواتير والجرد، وخذ نسخة احتياطية. بعد الإقفال لا يمكن إضافة أو تعديل مستندات بتاريخ داخل الفترة.</Banner>
            <button className="btn danger primary lg" disabled={busy || !can('period.lock')} onClick={close}><Lock /> إقفال الفترة</button>
            {!can('period.lock') && <div className="footnote">يحتاج صلاحية «قفل الفترات».</div>}
          </>
        )}
      </div>
    </div>
  );
}
