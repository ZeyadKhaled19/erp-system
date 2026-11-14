import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowUpRight, BarChart3, FileText, Package, Scale, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { Hint } from './Hint';

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'النهارده' },
  { key: 'yesterday', label: 'امبارح' },
  { key: 'week', label: '7 أيام' },
  { key: 'month', label: 'الشهر' },
  { key: 'year', label: 'السنة' },
];
const PREV_LABEL: Record<Period, string> = {
  today: 'عن امبارح', yesterday: 'عن اليوم اللي قبله', week: 'عن الـ7 أيام اللي قبلها', month: 'عن نفس الفترة الشهر اللي فات', year: 'عن نفس الفترة السنة اللي فاتت',
};

const iso = (d: Date) => todayISO(d);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** الفترة الحالية والفترة اللي قبلها بنفس الطول (للمقارنة) */
function ranges(p: Period) {
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  if (p === 'today') return { from: iso(t), to: iso(t), pFrom: iso(addDays(t, -1)), pTo: iso(addDays(t, -1)) };
  if (p === 'yesterday') return { from: iso(addDays(t, -1)), to: iso(addDays(t, -1)), pFrom: iso(addDays(t, -2)), pTo: iso(addDays(t, -2)) };
  if (p === 'week') return { from: iso(addDays(t, -6)), to: iso(t), pFrom: iso(addDays(t, -13)), pTo: iso(addDays(t, -7)) };
  if (p === 'month') {
    const from = new Date(t.getFullYear(), t.getMonth(), 1, 12);
    const pFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1, 12);
    const lastPrev = new Date(t.getFullYear(), t.getMonth(), 0, 12).getDate();
    const pTo = new Date(t.getFullYear(), t.getMonth() - 1, Math.min(t.getDate(), lastPrev), 12);
    return { from: iso(from), to: iso(t), pFrom: iso(pFrom), pTo: iso(pTo) };
  }
  const from = new Date(t.getFullYear(), 0, 1, 12);
  const pFrom = new Date(t.getFullYear() - 1, 0, 1, 12);
  const pTo = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate(), 12);
  return { from: iso(from), to: iso(t), pFrom: iso(pFrom), pTo: iso(pTo) };
}

interface Sums { sales: number; profit: number; profitKnown: boolean; invoices: number; credit: number; receipts: number; receiptsN: number; payments: number; paymentsN: number }
const empty = (): Sums => ({ sales: 0, profit: 0, profitKnown: true, invoices: 0, credit: 0, receipts: 0, receiptsN: 0, payments: 0, paymentsN: 0 });

function sum(docs: any[]): Sums {
  const s = empty();
  for (const d of docs) {
    if (d.status !== 'posted') continue;
    const total = d.total ?? 0;
    if (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return') {
      const sign = d.doc_type === 'sale_invoice' ? 1 : -1;
      s.sales += sign * total;
      if (d.cost == null) s.profitKnown = false;
      else s.profit += sign * (total - (d.tax ?? 0) - d.cost);
      if (sign > 0) {
        s.invoices++;
        s.credit += Math.max(0, total - (d.paid ?? 0));
      }
    } else if (d.doc_type === 'receipt' || d.doc_type === 'income') {
      s.receipts += total;
      s.receiptsN++;
    } else if (d.doc_type === 'payment' || d.doc_type === 'expense') {
      s.payments += total;
      s.paymentsN++;
    }
  }
  return s;
}

const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) * 100) / Math.abs(prev)) : null);

/** لوحة الأداء في الرئيسية: فترة قابلة للتغيير، 8 مؤشرات بمقارنة، رسم آخر 14 يوم، وأرصدة */
export function HomeKpis() {
  const nav = useNavigate();
  const can = usePerm();
  const [period, setPeriod] = useState<Period>('today');
  const r = useMemo(() => ranges(period), [period]);
  const days = useMemo(() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return Array.from({ length: 28 }, (_, i) => iso(addDays(t, i - 27)));
  }, []);

  const data = useLiveQuery(async () => {
    const start = [r.pFrom, days[0]].sort()[0];
    const docs = await db.documents.where('date').between(start, r.to > days[27] ? r.to : days[27], true, true).toArray();
    const cur = sum(docs.filter((d) => d.date >= r.from && d.date <= r.to));
    const prev = sum(docs.filter((d) => d.date >= r.pFrom && d.date <= r.pTo));
    const byDay = new Map<string, number>(days.map((d) => [d, 0]));
    for (const d of docs) {
      if (d.status !== 'posted' || !byDay.has(d.date)) continue;
      if (d.doc_type === 'sale_invoice') byDay.set(d.date, byDay.get(d.date)! + (d.total ?? 0));
      else if (d.doc_type === 'sale_return') byDay.set(d.date, byDay.get(d.date)! - (d.total ?? 0));
    }
    const series = days.map((d) => byDay.get(d) ?? 0);
    const cashboxes = (await db.cashboxes.toArray()).filter((c) => c.active);
    const parties = await db.parties.toArray();
    const receivables = parties.filter((p) => p.kind === 'customer').reduce((a, p) => a + Math.max(0, p.balance ?? 0), 0);
    const debtors = parties.filter((p) => p.kind === 'customer' && (p.balance ?? 0) > 0).length;
    const payables = parties.filter((p) => p.kind === 'supplier').reduce((a, p) => a + Math.max(0, p.balance ?? 0), 0);
    const creditors = parties.filter((p) => p.kind === 'supplier' && (p.balance ?? 0) > 0).length;
    const stock = await db.stock_balances.toArray();
    const stockValue = stock.reduce((a, b) => a + (b.value ?? 0), 0);
    const stockItems = new Set(stock.filter((b) => (b.qty ?? 0) > 0).map((b) => b.item_id)).size;
    return {
      cur, prev, series,
      cash: cashboxes.reduce((a, c) => a + (c.balance ?? 0), 0), boxes: cashboxes.length,
      receivables, debtors, payables, creditors, stockValue, stockItems,
    };
  }, [r.from, r.to, r.pFrom, r.pTo, days]);

  const c = data?.cur ?? empty();
  const p = data?.prev ?? empty();
  const vs = PREV_LABEL[period];
  const net = c.receipts - c.payments;
  const showSales = can('sales.view');
  const showProfit = can('costs.view') || can('reports.profit');
  const showCash = can('treasury.view');
  const showParties = can('parties.view');

  return (
    <section className="hk" aria-labelledby="hk-t">
      <div className="hk-head">
        <h2 id="hk-t">ملخص الأداء <Hint side="start" text="أرقام الفترة اللي تختارها من غير المسودات. كل كارت بيقارن بنفس طول الفترة اللي قبلها، والأرقام من بيانات الجهاز ده بعد آخر مزامنة." /></h2>
        <div className="segmented hk-periods" role="tablist" aria-label="الفترة">
          {PERIODS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={period === x.key} className={period === x.key ? 'on' : ''} onClick={() => setPeriod(x.key)}>{x.label}</button>
          ))}
        </div>
      </div>

      <div className="hk-grid">
        {showSales && (
          <Kpi dark label="صافي المبيعات" icon={<TrendingUp />} value={formatMoney(c.sales)} unit="ج.م" change={pct(c.sales, p.sales)} vs={vs}
            hint="إجمالي فواتير البيع المرحّلة في الفترة ناقص مرتجعات البيع، شامل الضريبة. النسبة مقارنة بالفترة اللي قبلها." onClick={() => nav('/docs/list/sales')} />
        )}
        {showSales && showProfit && (
          <Kpi label="صافي الربح" icon={<BarChart3 />} value={c.profitKnown ? formatMoney(c.profit) : '—'} unit={c.profitKnown ? 'ج.م' : ''}
            change={c.profitKnown && p.profitKnown ? pct(c.profit, p.profit) : null} vs={vs}
            sub={c.profitKnown ? (c.sales ? `هامش ${Math.round((c.profit * 100) / Math.max(1, c.sales))}%` : undefined) : 'التكلفة لسه بتتحسب بعد المزامنة'}
            hint="المبيعات بعد الضريبة ناقص تكلفة البضاعة المباعة (متوسط التكلفة وقت البيع)، وبيتخصم منها ربح المرتجعات. مش داخل فيه المصروفات." onClick={() => nav('/reports/analysis')} />
        )}
        {showSales && (
          <Kpi label="عدد الفواتير" icon={<FileText />} value={String(c.invoices)} unit="فاتورة" change={pct(c.invoices, p.invoices)} vs={vs}
            sub={`متوسط الفاتورة ${formatMoney(c.invoices ? Math.round(c.sales / c.invoices) : 0)}`}
            hint="عدد فواتير البيع المرحّلة في الفترة. متوسط الفاتورة = صافي المبيعات ÷ عدد الفواتير." onClick={() => nav('/docs/list/sales')} />
        )}
        {showSales && (
          <Kpi label="آجل على العملاء" icon={<Users />} value={formatMoney(c.credit)} unit="ج.م" tone={c.credit > 0 ? 'orange' : undefined}
            sub="من فواتير الفترة دي"
            hint="الجزء اللي لسه متدفعش من فواتير البيع اللي اتعملت في الفترة دي بس (الإجمالي ناقص المدفوع). الرصيد الكلي على العملاء تحت في «مستحق من العملاء»." onClick={() => nav('/receivables')} />
        )}
        {showCash && (
          <Kpi label="سندات القبض" icon={<ArrowDownLeft />} value={formatMoney(c.receipts)} unit="ج.م" change={pct(c.receipts, p.receipts)} vs={vs}
            sub={`${c.receiptsN} سند`} tone="green"
            hint="الفلوس اللي دخلت الخزائن بسندات قبض من العملاء وسندات الإيرادات الأخرى. مش داخل فيها المقبوض جوه فواتير البيع نفسها." onClick={() => nav('/docs/list/treasury')} />
        )}
        {showCash && (
          <Kpi label="سندات الصرف" icon={<ArrowUpRight />} value={formatMoney(c.payments)} unit="ج.م" change={pct(c.payments, p.payments)} vs={vs} invert
            sub={`${c.paymentsN} سند`} tone="red"
            hint="الفلوس اللي خرجت بسندات صرف للموردين والمصروفات. مش داخل فيها المدفوع جوه فواتير الشراء نفسها." onClick={() => nav('/docs/list/treasury')} />
        )}
        {showCash && (
          <Kpi label="صافي السندات" icon={<Scale />} value={formatMoney(Math.abs(net))} unit="ج.م"
            sub={net > 0 ? 'فايض قبض' : net < 0 ? 'فايض صرف' : 'متعادل'} tone={net > 0 ? 'green' : net < 0 ? 'red' : undefined}
            hint="سندات القبض ناقص سندات الصرف في الفترة. «فايض قبض» يعني اللي دخل أكتر من اللي خرج." />
        )}
        {showCash && (
          <Kpi label="النقدية بالخزائن" icon={<Wallet />} value={formatMoney(data?.cash ?? 0)} unit="ج.م" sub={`${data?.boxes ?? 0} خزينة وبنك`}
            hint="الرصيد الحالي لكل الخزائن والحسابات البنكية المفعّلة دلوقتي، مش مرتبط بالفترة المختارة." onClick={() => nav('/cashboxes')} />
        )}
      </div>

      <div className="hk-row">
        {showSales && (
          <div className="hk-card hk-chart-card">
            <div className="hk-card-h">
              <div>
                <h3>المبيعات آخر 14 يوم <Hint side="start" text="كل عمود = صافي مبيعات يوم (الفواتير ناقص المرتجعات). الخط المتقطع = نفس اليوم في الأسبوعين اللي قبلهم، عشان تقارن." /></h3>
                <span className="hk-card-sub">مقارنة بالـ14 يوم اللي قبلهم</span>
              </div>
              <span className="hk-legend"><i className="cur" /> الفترة دي <i className="prev" /> اللي قبلها</span>
            </div>
            <SalesChart series={data?.series ?? []} days={days} />
          </div>
        )}
        {(showParties || can('costs.view')) && (
          <div className="hk-card hk-bal">
            <div className="hk-card-h"><h3>الأرصدة الحالية <Hint side="start" text="أرصدة لحظية مش مرتبطة بالفترة: اللي على العملاء، واللي علينا للموردين، وقيمة البضاعة اللي في المخازن بالتكلفة." /></h3></div>
            {showParties && <BalRow icon={<Users />} label="مستحق من العملاء" value={data?.receivables ?? 0} sub={`${data?.debtors ?? 0} عميل عليهم فلوس`} onClick={() => nav('/parties/customer')} hint="مجموع أرصدة العملاء المدينين (اللي عليهم فلوس) من كل الفواتير، مش الفترة دي بس." />}
            {showParties && <BalRow icon={<ShoppingBag />} label="مستحق للموردين" value={data?.payables ?? 0} sub={`${data?.creditors ?? 0} مورد ليهم فلوس`} onClick={() => nav('/parties/supplier')} hint="مجموع اللي علينا للموردين من كل فواتير الشراء اللي لسه متدفعتش بالكامل." />}
            {can('costs.view') && <BalRow icon={<Package />} label="قيمة المخزون" value={data?.stockValue ?? 0} sub={`${data?.stockItems ?? 0} صنف ليه رصيد`} onClick={() => nav('/reports/stock')} hint="رصيد كل الأصناف في كل المخازن مضروب في متوسط التكلفة. مش سعر البيع." />}
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, icon, value, unit, change, vs, sub, hint, tone, dark, invert, onClick }: {
  label: string; icon: ReactNode; value: string; unit?: string; change?: number | null; vs?: string; sub?: string; hint: string;
  tone?: 'green' | 'red' | 'orange'; dark?: boolean; invert?: boolean; onClick?: () => void;
}) {
  // للصرف: الزيادة مش حاجة كويسة، فلونها بيتعكس
  const good = change != null && (invert ? change <= 0 : change >= 0);
  return (
    <div className={`hk-kpi ${dark ? 'dark' : ''} ${onClick ? 'click' : ''}`}>
      {onClick && <button type="button" className="hk-hit" aria-label={`افتح تفاصيل ${label}`} onClick={onClick} />}
      <span className="hk-kpi-top">
        <span className="hk-kpi-l">{label} <Hint side="start" text={hint} /></span>
        <span className="hk-kpi-ic">{icon}</span>
      </span>
      <span className="hk-kpi-v"><b className="num">{value}</b>{unit && <small>{unit}</small>}</span>
      <span className="hk-kpi-foot">
        {change != null ? <span className={`hk-chg ${good ? 'up' : 'down'}`}>{change > 0 ? '+' : ''}{change}% {vs}</span> : null}
        {sub && <span className={`hk-sub ${tone ?? ''}`}>{sub}</span>}
      </span>
    </div>
  );
}

function BalRow({ icon, label, value, sub, hint, onClick }: { icon: ReactNode; label: string; value: number; sub: string; hint: string; onClick: () => void }) {
  return (
    <div className="hk-bal-row">
      <button type="button" className="hk-hit" aria-label={`افتح ${label}`} onClick={onClick} />
      <span className="hk-kpi-ic">{icon}</span>
      <span className="hk-bal-t">
        <span className="hk-bal-l">{label} <Hint side="start" text={hint} /></span>
        <span className="hk-bal-s">{sub}</span>
      </span>
      <b className="num">{formatMoney(value)}</b>
    </div>
  );
}

/** أعمدة الـ14 يوم الأخيرة + خط متقطع للـ14 يوم اللي قبلهم. الأحدث على الشمال (اتجاه عربي) */
function SalesChart({ series, days }: { series: number[]; days: string[] }) {
  const cur = series.slice(14);
  const prev = series.slice(0, 14);
  const labels = days.slice(14);
  const max = Math.max(1, ...cur.map(Math.abs), ...prev.map(Math.abs));
  // خطوة مقربة ونهاية المحور أقرب مضاعف فوق أعلى قيمة (من غير فراغ كبير فوق الأعمدة)
  const step = niceStep(max / 4);
  const ticks = Math.max(1, Math.ceil(max / step));
  const top = step * ticks;
  const W = 700, H = 220, padL = 44, padB = 26, padT = 8;
  const cw = (W - padL) / 14;
  const y = (v: number) => padT + (H - padT - padB) * (1 - Math.max(0, v) / top);
  const x = (i: number) => W - padL - (i + 0.5) * cw; // i=0 أقدم يوم على اليمين
  const line = prev.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="hk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`مبيعات آخر 14 يوم: ${formatMoney(cur.reduce((a, b) => a + b, 0))}`}>
      {Array.from({ length: ticks + 1 }, (_, k) => k).map((k) => (
        <g key={k}>
          <line x1={0} x2={W - padL} y1={y(step * k)} y2={y(step * k)} className="hk-grid-l" />
          <text x={W - padL + 6} y={y(step * k) + 4} className="hk-axis" textAnchor="start">{axisLabel(step * k)}</text>
        </g>
      ))}
      {cur.map((v, i) => {
        const h = Math.max(1.5, y(0) - y(v));
        return (
          <rect key={labels[i]} x={x(i) - cw * 0.28} y={y(0) - h} width={cw * 0.56} height={h} rx={3} className={i === 13 ? 'hk-bar today' : 'hk-bar'}>
            <title>{`${labels[i]}: ${formatMoney(v)} · قبلها بأسبوعين: ${formatMoney(prev[i] ?? 0)}`}</title>
          </rect>
        );
      })}
      <path d={line} className="hk-prev" />
      {labels.map((d, i) => (
        <text key={d} x={x(i)} y={H - 8} className="hk-axis" textAnchor="middle">{`${d.slice(8, 10)}/${d.slice(5, 7)}`}</text>
      ))}
    </svg>
  );
}

/** المبالغ متخزنة بالقرش: المحور يعرضها بالجنيه من غير كسور */
function axisLabel(v: number) {
  return formatMoney(Math.round(v)).replace(/\.00$/, '');
}

function niceStep(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
