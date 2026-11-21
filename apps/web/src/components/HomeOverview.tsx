import { formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, Package, Wallet } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { Hint } from './Hint';

/*
 * الجزء العلوي من الرئيسية زي التصميم المعتمد (2026-11-21):
 * كارت «حركة الشغل» الداكن، وصف المؤشرات الأربعة بخط صغير.
 * كل الأرقام قراءة بس من بيانات الجهاز (المستندات المرحّلة)، من غير أي بيانات تجريبية.
 */

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const SPARK_DAYS = 14;

/** المبالغ بالقرش: المحور بالجنيه من غير كسور */
const axisMoney = (v: number) => formatMoney(Math.round(v)).replace(/\.00$/, '');

function niceStep(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** «حركة الشغل»: قيمة فواتير البيع والشراء المرحّلة النهارده، تراكمي بالساعة */
export function ActivityCard() {
  const can = usePerm();
  const showSales = can('sales.view');
  const showPurchases = can('purchases.view');
  const today = todayISO();
  // الرسم بعرضه الحقيقي (من غير تمطيط) علشان الكلام يفضل واضح على كل المقاسات
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(260, Math.round(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const data = useLiveQuery(async () => {
    const types = [showSales && 'sale_invoice', showPurchases && 'purchase_invoice'].filter(Boolean) as string[];
    const docs = (await Promise.all(types.map((t) => db.documents.where('[doc_type+date]').equals([t, today]).toArray()))).flat()
      .filter((d) => d.status === 'posted');
    const byHour = new Map<number, number>();
    let total = 0;
    for (const d of docs) {
      const v = d.total ?? 0;
      total += v;
      const t = d.created_at ? new Date(d.created_at) : null;
      const h = t && !Number.isNaN(t.getTime()) && todayISO(t) === today ? t.getHours() : 12;
      byHour.set(h, (byHour.get(h) ?? 0) + v);
    }
    return { total, byHour, count: docs.length };
  }, [today, showSales, showPurchases]);

  const nowH = new Date().getHours();
  const hours = data ? [...data.byHour.keys()] : [];
  const startH = Math.min(8, ...hours);
  const endH = Math.max(18, nowH, ...hours);
  const lastH = Math.max(startH, Math.min(endH, Math.max(nowH, ...hours)));
  const points: { h: number; v: number }[] = [];
  let run = 0;
  for (let h = startH; h <= lastH; h++) {
    run += data?.byHour.get(h) ?? 0;
    points.push({ h, v: run });
  }
  // من غير حركة: محور افتراضي لحد 1,000 ج.م بدل كسور قروش
  const max = Math.max(100_000, run);
  const step = niceStep(max / 4);
  const ticks = Math.max(1, Math.ceil(max / step));
  const top = step * ticks;
  const H = 210, padL = 52, padR = 14, padT = 12, padB = 28;
  const x = (h: number) => padL + ((W - padL - padR) * (h - startH)) / Math.max(1, endH - startH);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.h).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${x(points[points.length - 1].h).toFixed(1)},${y(0)} L${x(points[0].h).toFixed(1)},${y(0)} Z` : '';
  const labelEvery = W < 480 ? (endH - startH > 12 ? 4 : 3) : endH - startH > 12 ? 3 : 2;
  const last = points[points.length - 1];

  return (
    <section className="ds-card ds-dark home-activity" aria-labelledby="home-activity-t">
      <div className="home-activity-head">
        <div className="home-activity-total">
          <b className="num">{formatMoney(data?.total ?? 0)} <small>ج.م</small></b>
          <span>قيمة حركة الشغل اليوم{data ? ` · ${data.count} فاتورة` : ''}</span>
        </div>
        <div className="home-activity-title">
          <h2 id="home-activity-t"><BarChart3 className="ds-ic" /> حركة الشغل <Hint side="start" text="مجموع فواتير البيع والشراء المرحّلة النهارده (حسب صلاحياتك)، والخط بيطلع تراكمي ساعة بساعة من وقت تسجيل كل فاتورة." /></h2>
          <span>إجمالي قيمة العمليات ({showSales && showPurchases ? 'مبيعات ومشتريات' : showSales ? 'مبيعات' : 'مشتريات'})</span>
        </div>
      </div>
      <div className="home-activity-chart" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`حركة الشغل النهارده: ${formatMoney(data?.total ?? 0)} جنيه`}>
          <defs>
            <linearGradient id="home-activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--tint)" stopOpacity="0.85" />
              <stop offset="100%" stopColor="var(--tint)" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {Array.from({ length: ticks + 1 }, (_, k) => k).map((k) => (
            <g key={k}>
              <line x1={padL} x2={W - padR} y1={y(step * k)} y2={y(step * k)} className="ha-grid" />
              <text x={padL - 8} y={y(step * k) + 4} className="ha-axis" textAnchor="end">{axisMoney(step * k)}</text>
            </g>
          ))}
          {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).filter((h) => (h - startH) % labelEvery === 0 || h === endH).map((h) => (
            <text key={h} x={x(h)} y={H - 8} className="ha-axis" textAnchor="middle">{`${String(h).padStart(2, '0')}:00`}</text>
          ))}
          {area && <path d={area} fill="url(#home-activity-fill)" />}
          {line && <path d={line} className="ha-line" />}
          {last && <circle cx={x(last.h)} cy={y(last.v)} r={5} className="ha-dot" />}
        </svg>
      </div>
    </section>
  );
}

interface DaySums { profit: number; profitKnown: boolean; invoices: number }

/** صف المؤشرات الأربعة (النهارده): صافي الربح، الفواتير، النقدية، قيمة المخزون */
export function KpiStrip() {
  const nav = useNavigate();
  const can = usePerm();
  const showSales = can('sales.view');
  const showProfit = showSales && (can('costs.view') || can('reports.profit'));
  const showCash = can('treasury.view');
  const showStock = can('costs.view');
  const days = useMemo(() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return Array.from({ length: SPARK_DAYS }, (_, i) => todayISO(addDays(t, i - SPARK_DAYS + 1)));
  }, []);
  const data = useLiveQuery(async () => {
    const byDay = new Map<string, DaySums>(days.map((d) => [d, { profit: 0, profitKnown: true, invoices: 0 }]));
    if (showSales) {
      const docs = (await Promise.all(['sale_invoice', 'sale_return'].map((t) => db.documents.where('[doc_type+date]').between([t, days[0]], [t, days[days.length - 1]], true, true).toArray()))).flat();
      for (const d of docs) {
        const s = byDay.get(d.date);
        if (!s || d.status !== 'posted') continue;
        const sign = d.doc_type === 'sale_invoice' ? 1 : -1;
        if (d.cost == null) s.profitKnown = false;
        else s.profit += sign * ((d.total ?? 0) - (d.tax ?? 0) - d.cost);
        if (sign > 0) s.invoices++;
      }
    }
    const series = days.map((d) => byDay.get(d)!);
    const cashboxes = showCash ? (await db.cashboxes.toArray()).filter((c) => c.active) : [];
    const stock = showStock ? await db.stock_balances.toArray() : [];
    return {
      series,
      cash: cashboxes.reduce((a, c) => a + (c.balance ?? 0), 0), boxes: cashboxes.length,
      stockValue: stock.reduce((a, b) => a + (b.value ?? 0), 0),
      stockItems: new Set(stock.filter((b) => (b.qty ?? 0) > 0).map((b) => b.item_id)).size,
    };
  }, [days, showSales, showCash, showStock]);

  const todayS = data?.series[data.series.length - 1];
  const tiles: ReactNode[] = [];
  if (showProfit) tiles.push(
    <KpiTile key="profit" label="صافي الربح" value={todayS?.profitKnown === false ? '—' : formatMoney(todayS?.profit ?? 0)} unit={todayS?.profitKnown === false ? '' : 'ج.م'}
      sub={todayS?.profitKnown === false ? 'التكلفة لسه بتتحسب بعد المزامنة' : 'ربح مبيعات اليوم'} spark={data?.series.map((s) => s.profit)}
      hint="مبيعات النهارده بعد الضريبة ناقص تكلفة البضاعة المباعة، وبيتخصم ربح المرتجعات. الخط الصغير = آخر 14 يوم." onClick={() => nav('/reports/analysis')} />,
  );
  if (showSales) tiles.push(
    <KpiTile key="inv" label="الفواتير" value={String(todayS?.invoices ?? 0)} unit="فاتورة" sub="إجمالي الفواتير اليوم" spark={data?.series.map((s) => s.invoices)}
      hint="عدد فواتير البيع المرحّلة النهارده. الخط الصغير = عددها في آخر 14 يوم." onClick={() => nav('/docs/list/sales')} />,
  );
  if (showCash) tiles.push(
    <KpiTile key="cash" label="النقدية" value={formatMoney(data?.cash ?? 0)} unit="ج.م" sub={`${data?.boxes ?? 0} خزينة وبنك`} icon={<Wallet />}
      hint="الرصيد الحالي لكل الخزائن والحسابات البنكية المفعّلة." onClick={() => nav('/cashboxes')} />,
  );
  if (showStock) tiles.push(
    <KpiTile key="stock" label="قيمة المخزون" value={formatMoney(data?.stockValue ?? 0)} unit="ج.م" sub={`${data?.stockItems ?? 0} صنف ليه رصيد`} icon={<Package />}
      hint="رصيد كل الأصناف في كل المخازن مضروب في متوسط التكلفة (مش سعر البيع)." onClick={() => nav('/reports/stock')} />,
  );
  if (!tiles.length) return null;
  return <section className="ds-card home-kpis" aria-label="مؤشرات اليوم" style={{ ['--n' as string]: tiles.length }}>{tiles}</section>;
}

function KpiTile({ label, value, unit, sub, spark, icon, hint, onClick }: {
  label: string; value: string; unit?: string; sub: string; spark?: number[]; icon?: ReactNode; hint: string; onClick: () => void;
}) {
  return (
    <div className="home-kpi">
      <button type="button" className="hk-hit" aria-label={`افتح تفاصيل ${label}`} onClick={onClick} />
      <div className="home-kpi-t">
        <span className="home-kpi-l">{label} <Hint side="start" text={hint} /></span>
        <span className="home-kpi-v"><b className="num">{value}</b>{unit && <small>{unit}</small>}</span>
        <span className="home-kpi-s">{sub}</span>
      </div>
      {spark ? <Sparkline values={spark} /> : <span className="home-kpi-ic" aria-hidden="true">{icon}</span>}
    </div>
  );
}

/** خط صغير بمساحة باهتة تحته، الأقدم على الشمال والنهارده على اليمين زي محور الوقت */
function Sparkline({ values }: { values: number[] }) {
  const W = 96, H = 36;
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (i: number) => (W * i) / Math.max(1, values.length - 1);
  const y = (v: number) => 3 + (H - 6) * (1 - (v - min) / (max - min || 1));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="home-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="none">
      <path d={`${d} L${W},${H} L0,${H} Z`} className="home-spark-a" />
      <path d={d} className="home-spark-l" />
    </svg>
  );
}
