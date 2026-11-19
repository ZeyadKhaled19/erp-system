import { formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowUpRight, BarChart3, Clock3, FileText, Package, Scale, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { payParts } from '../lib/payMethod';
import { usePerm, useSession, userCashboxes } from '../lib/hooks';
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
  today: 'عن امبارح', yesterday: 'عن اليوم اللي قبله', week: 'عن الـ7 أيام اللي قبلها', month: 'عن نفس المدة الشهر اللي فات', year: 'عن نفس المدة السنة اللي فاتت',
};
const iso = (d: Date) => todayISO(d);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** الفترة الحالية والفترة السابقة ذات المدة المقابلة، بالتاريخ المحلي للجهاز. */
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
interface ChartPoint { label: string; current: number; previous: number }
interface MethodSum { id: string; name: string; incoming: number; outgoing: number }
interface SoldItem { id: string; name: string; unit: string; qty: number; value: number }
interface BoxSum { id: string; name: string; kind: string; balance: number }

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
const salesTypes = new Set(['sale_invoice', 'sale_return']);
const paidDocDirection: Record<string, 'in' | 'out'> = {
  sale_invoice: 'in', sale_return: 'out', purchase_invoice: 'out', purchase_return: 'in',
  receipt: 'in', income: 'in', payment: 'out', expense: 'out',
};
const moneyPeriod = (docs: any[], from: string, to: string) => docs.filter((d) => d.status === 'posted' && salesTypes.has(d.doc_type) && d.date >= from && d.date <= to);

function localDay(date: Date) {
  return iso(date);
}

function dateAtOffset(date: string, offset: number) {
  return addDays(new Date(`${date}T12:00:00`), offset);
}

function chartSeries(docs: any[], period: Period, r: ReturnType<typeof ranges>) {
  const curDocs = moneyPeriod(docs, r.from, r.to);
  const prevDocs = moneyPeriod(docs, r.pFrom, r.pTo);
  const sign = (d: any) => d.doc_type === 'sale_invoice' ? 1 : -1;
  if (period === 'today' || period === 'yesterday') {
    const bucket = (rows: any[], date: string) => {
      const values = Array(24).fill(0) as number[];
      let valid = 0;
      for (const d of rows.filter((x) => x.date === date)) {
        const stamp = typeof d.created_at === 'string' ? new Date(d.created_at) : new Date('');
        if (!Number.isFinite(stamp.getTime()) || localDay(stamp) !== d.date) continue;
        values[stamp.getHours()] += sign(d) * (d.total ?? 0);
        valid++;
      }
      return { values, valid, count: rows.filter((x) => x.date === date).length };
    };
    const current = bucket(curDocs, r.from);
    const previous = bucket(prevDocs, r.pFrom);
    const complete = current.count > 0 && current.valid === current.count;
    const previousComplete = previous.count === 0 || previous.valid === previous.count;
    const dateLabel = period === 'today' ? 'اليوم' : 'أمس';
    return {
      title: `حركة المبيعات ${dateLabel} حسب الساعة`,
      compare: period === 'today' ? 'مقارنة بأمس' : 'مقارنة باليوم السابق',
      points: complete ? current.values.map((v, i) => ({ label: `${String(i).padStart(2, '0')}:00`, current: v, previous: previousComplete ? previous.values[i] : 0 })) : [],
      unavailable: current.count === 0 ? `لا توجد فواتير بيع أو مرتجعات مرحّلة في ${dateLabel}.` : 'تعذر رسم الحركة بالساعة: بعض الفواتير لا تحتوي على وقت إنشاء محلي موثوق.',
      hasPrevious: previousComplete,
    };
  }

  const points: ChartPoint[] = [];
  if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const currentDate = iso(dateAtOffset(r.from, i));
      const previousDate = iso(dateAtOffset(r.pFrom, i));
      const label = new Date(`${currentDate}T12:00:00`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'numeric' });
      const current = curDocs.filter((d) => d.date === currentDate).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0);
      const previous = prevDocs.filter((d) => d.date === previousDate).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0);
      points.push({ label, current, previous });
    }
  } else if (period === 'month') {
    const days = Number(r.to.slice(8, 10));
    for (let i = 0; i < days; i++) {
      const cd = iso(dateAtOffset(r.from, i));
      const previousMax = new Date(`${r.pTo}T12:00:00`).getDate();
      const pd = iso(dateAtOffset(r.pFrom, Math.min(i, previousMax - 1)));
      points.push({ label: String(i + 1), current: curDocs.filter((d) => d.date === cd).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0), previous: prevDocs.filter((d) => d.date === pd).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0) });
    }
  } else {
    const monthIndex = Number(r.to.slice(5, 7));
    for (let i = 0; i < monthIndex; i++) {
      const current = curDocs.filter((d) => Number(d.date.slice(5, 7)) === i + 1).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0);
      const previous = prevDocs.filter((d) => Number(d.date.slice(5, 7)) === i + 1).reduce((s, d) => s + sign(d) * (d.total ?? 0), 0);
      const label = new Date(2024, i, 1, 12).toLocaleDateString('ar-EG', { month: 'short' });
      points.push({ label, current, previous });
    }
  }
  return { title: period === 'week' ? 'المبيعات آخر 7 أيام' : period === 'month' ? 'المبيعات من أول الشهر' : 'المبيعات من أول السنة', compare: PREV_LABEL[period], points, unavailable: '', hasPrevious: true };
}

function paymentMethods(docs: any[], cashboxes: BoxSum[]): MethodSum[] {
  const byId = new Map(cashboxes.map((b) => [b.id, b]));
  const sums = new Map<string, MethodSum>();
  for (const d of docs) {
    if (d.status !== 'posted' || !paidDocDirection[d.doc_type]) continue;
    let parts = payParts(d, byId);
    if (!parts.length && d.cashbox_id && !['sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return'].includes(d.doc_type) && (d.total ?? 0) > 0) {
      const box = byId.get(d.cashbox_id);
      if (box) parts = [{ id: box.id, name: box.kind === 'cash' ? 'نقدي' : box.name, amount: d.total, kind: box.kind }];
    }
    const direction = paidDocDirection[d.doc_type];
    for (const part of parts) {
      const box = byId.get(part.id);
      if (!box || part.amount <= 0) continue;
      const id = box.kind === 'cash' ? 'cash' : box.id;
      const name = box.kind === 'cash' ? 'نقدي' : box.name;
      const row = sums.get(id) ?? { id, name, incoming: 0, outgoing: 0 };
      row[direction === 'in' ? 'incoming' : 'outgoing'] += part.amount;
      sums.set(id, row);
    }
  }
  return [...sums.values()].sort((a, b) => (b.incoming + b.outgoing) - (a.incoming + a.outgoing));
}

/** لوحة الأداء والتحليلات: كلها محلية، وتُحمّل البيانات المسموح بها فقط. */
export function HomeKpis({ warehouseId }: { warehouseId?: string } = {}) {
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const [period, setPeriod] = useState<Period>('today');
  const [itemSort, setItemSort] = useState<'qty' | 'value'>('qty');
  const r = useMemo(() => ranges(period), [period]);
  const permsKey = session.user.permissions.join(',');
  const cashboxScopeKey = (session.user.cashbox_ids ?? []).join(',');
  const warehouseScopeKey = (session.user.warehouse_ids ?? []).join(',');
  const showSales = can('sales.view');
  const showProfit = can('costs.view') || can('reports.profit');
  const showCash = can('treasury.view');
  const showParties = can('parties.view');
  const showInventory = can('inventory.view');
  const showStockValue = can('costs.view');
  const canSeePurchases = can('purchases.view');

  const data = useLiveQuery(async () => {
    const queryTypes = [
      ...(showSales ? ['sale_invoice', 'sale_return'] : []),
      ...(showCash ? ['receipt', 'income', 'payment', 'expense'] : []),
      ...(showCash && canSeePurchases ? ['purchase_invoice', 'purchase_return'] : []),
    ];
    const start = r.pFrom;
    const end = r.to;
    const batches = await Promise.all(queryTypes.map((type) => db.documents.where('[doc_type+date]').between([type, start], [type, end], true, true).toArray()));
    const warehouseScopedTypes = new Set(['sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return']);
    const docs = batches.flat().filter((doc) => !warehouseId || !warehouseScopedTypes.has(doc.doc_type) || doc.warehouse_id === warehouseId);
    const cur = sum(docs.filter((d) => d.date >= r.from && d.date <= r.to));
    const prev = sum(docs.filter((d) => d.date >= r.pFrom && d.date <= r.pTo));
    const series = chartSeries(docs, period, r);

    const cashboxes = showCash ? (await userCashboxes(session.user)).map((b) => ({ id: b.id, name: b.name, kind: b.kind, balance: b.balance ?? 0 })) : [];
    const methods = showCash ? paymentMethods(docs.filter((d) => d.date >= r.from && d.date <= r.to), cashboxes) : [];
    const cash = cashboxes.reduce((a, c) => a + c.balance, 0);

    let receivables = 0, debtors = 0, payables = 0, creditors = 0;
    if (showParties) {
      const parties = await db.parties.toArray();
      receivables = parties.filter((p) => p.kind === 'customer').reduce((a, p) => a + Math.max(0, p.balance ?? 0), 0);
      debtors = parties.filter((p) => p.kind === 'customer' && (p.balance ?? 0) > 0).length;
      payables = parties.filter((p) => p.kind === 'supplier').reduce((a, p) => a + Math.max(0, p.balance ?? 0), 0);
      creditors = parties.filter((p) => p.kind === 'supplier' && (p.balance ?? 0) > 0).length;
    }

    const needsInventory = showInventory || showStockValue;
    let stockRows: any[] = [];
    let items: any[] = [];
    if (needsInventory) {
      const balances = await db.stock_balances.toArray();
      const allowedWarehouses = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
      stockRows = balances.filter((b) => (!allowedWarehouses || allowedWarehouses.has(b.warehouse_id)) && (!warehouseId || b.warehouse_id === warehouseId));
      if (showInventory) items = (await db.items.toArray()).filter((i) => i.active !== false && !i.is_service);
    }
    const qtyByItem = new Map<string, number>();
    for (const row of stockRows) qtyByItem.set(row.item_id, (qtyByItem.get(row.item_id) ?? 0) + (row.qty ?? 0));
    const hasWarehouseScope = session.user.warehouse_ids == null || session.user.warehouse_ids.length > 0;
    const lowStock = showInventory && hasWarehouseScope ? items
      .filter((item) => item.reorder_level > 0 && (qtyByItem.get(item.id) ?? 0) <= item.reorder_level)
      .map((item) => ({ id: item.id, name: item.name, qty: qtyByItem.get(item.id) ?? 0, min: item.reorder_level }))
      .sort((a, b) => a.qty - b.qty)
      .slice(0, 4) : [];

    let topItems: SoldItem[] = [];
    if (showSales) {
      const salesDocs = moneyPeriod(docs, r.from, r.to);
      if (salesDocs.length) {
        const docIds = salesDocs.map((d) => d.id);
        const lines = await db.document_lines.where('document_id').anyOf(docIds).toArray();
        const rollup = new Map<string, { qty: number; value: number }>();
        const direction = new Map(salesDocs.map((d) => [d.id, d.doc_type === 'sale_invoice' ? 1 : -1]));
        for (const line of lines) {
          const sign = direction.get(line.document_id) ?? 1;
          const row = rollup.get(line.item_id) ?? { qty: 0, value: 0 };
          row.qty += sign * (line.base_qty ?? line.qty ?? 0);
          row.value += sign * (line.total ?? 0);
          rollup.set(line.item_id, row);
        }
        const ranked = [...rollup.entries()].filter(([, v]) => v.qty > 0 || v.value > 0);
        const itemRows = await db.items.bulkGet(ranked.map(([id]) => id));
        const byItem = new Map(itemRows.filter(Boolean).map((item: any) => [item.id, item]));
        topItems = ranked.map(([id, v]) => ({ id, name: byItem.get(id)?.name ?? 'صنف غير معروف', unit: byItem.get(id)?.base_unit ?? '', ...v }));
      }
    }

    return {
      cur, prev, series, cash, cashboxes, methods,
      receivables, debtors, payables, creditors,
      stockValue: stockRows.reduce((a, b) => a + (b.value ?? 0), 0),
      stockItems: new Set(stockRows.filter((b) => (b.qty ?? 0) > 0).map((b) => b.item_id)).size,
      lowStock, topItems,
    };
  }, [period, r.from, r.to, r.pFrom, r.pTo, permsKey, cashboxScopeKey, warehouseScopeKey, session.user.id, warehouseId]);

  const c = data?.cur ?? empty();
  const p = data?.prev ?? empty();
  const vs = PREV_LABEL[period];
  const net = c.receipts - c.payments;
  const periodLabel = PERIODS.find((x) => x.key === period)?.label ?? 'الفترة';
  const salesChange = pct(c.sales, p.sales);
  const insight: string[] = [];
  if (showSales && salesChange != null && c.sales !== p.sales) {
    insight.push(`صافي المبيعات ${salesChange > 0 ? 'زاد' : 'انخفض'} ${Math.abs(salesChange)}% مقارنة بالفترة السابقة.`);
  }
  if (showInventory && data?.lowStock.length) {
    insight.push(`${data.lowStock.length} أصناف وصلت لحد الطلب أو أقل، حسب أرصدة المخازن المتاحة لك.`);
  }

  return (
    <section className="hk" aria-labelledby="hk-t">
      <div className="hk-head">
        <h2 id="hk-t">ملخص الأداء <Hint side="start" text="بيانات محلية من المستندات المرحلة. المسودات والملغى مستبعدان، وكل مقارنة مع الفترة السابقة المقابلة." /></h2>
        <div className="segmented hk-periods" role="tablist" aria-label="الفترة">
          {PERIODS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={period === x.key} className={period === x.key ? 'on' : ''} onClick={() => setPeriod(x.key)}>{x.label}</button>
          ))}
        </div>
      </div>

      <div className="hk-grid">
        {showSales && <Kpi dark label="صافي المبيعات" icon={<TrendingUp />} value={formatMoney(c.sales)} unit="ج.م" change={salesChange} vs={vs}
          hint="فواتير البيع المرحلة ناقص مرتجعات البيع المرحلة، شامل الضريبة. لا تدخل المسودات أو المستندات الملغاة." onClick={() => nav('/docs/list/sales')} />}
        {showSales && showProfit && <Kpi label="صافي الربح" icon={<BarChart3 />} value={c.profitKnown ? formatMoney(c.profit) : '—'} unit={c.profitKnown ? 'ج.م' : ''}
          change={c.profitKnown && p.profitKnown ? pct(c.profit, p.profit) : null} vs={vs}
          sub={c.profitKnown ? (c.sales ? `هامش ${Math.round((c.profit * 100) / Math.max(1, c.sales))}%` : undefined) : 'التكلفة غير متاحة لبعض الفواتير'}
          hint="المبيعات بعد الضريبة ناقص التكلفة الفعلية المسجلة وقت الترحيل، مع طرح ربح المرتجعات. لا يُستنتج الربح من سعر البيع." onClick={can('reports.view') ? () => nav('/reports/analysis') : undefined} />}
        {showSales && <Kpi label="عدد الفواتير" icon={<FileText />} value={String(c.invoices)} unit="فاتورة" change={pct(c.invoices, p.invoices)} vs={vs}
          sub={`متوسط الفاتورة ${formatMoney(c.invoices ? Math.round(c.sales / c.invoices) : 0)}`}
          hint="عدد فواتير البيع المرحلة. متوسط الفاتورة = صافي المبيعات ÷ عدد الفواتير." onClick={() => nav('/docs/list/sales')} />}
        {showSales && <Kpi label="المبيعات الآجلة" icon={<Users />} value={formatMoney(c.credit)} unit="ج.م" tone={c.credit > 0 ? 'orange' : undefined} sub="من فواتير الفترة المختارة"
          hint="إجمالي الفاتورة ناقص ما سُجل مدفوعًا داخل الفاتورة نفسها. سندات القبض اللاحقة معروضة منفصلة ولا تُجمع هنا." onClick={() => nav('/receivables')} />}
        {showCash && <Kpi label="سندات القبض" icon={<ArrowDownLeft />} value={formatMoney(c.receipts)} unit="ج.م" change={pct(c.receipts, p.receipts)} vs={vs} sub={`${c.receiptsN} سند`} tone="green"
          hint="سندات القبض والإيرادات المرحلة في الفترة. لا تشمل المدفوع المسجل داخل الفواتير." onClick={() => nav('/docs/list/treasury')} />}
        {showCash && <Kpi label="سندات الصرف" icon={<ArrowUpRight />} value={formatMoney(c.payments)} unit="ج.م" change={pct(c.payments, p.payments)} vs={vs} invert sub={`${c.paymentsN} سند`} tone="red"
          hint="سندات الصرف والمصروفات المرحلة في الفترة. لا تشمل المدفوع المسجل داخل فواتير الشراء." onClick={() => nav('/docs/list/treasury')} />}
        {showCash && <Kpi label="صافي السندات" icon={<Scale />} value={formatMoney(Math.abs(net))} unit="ج.م" sub={net > 0 ? 'فائض قبض' : net < 0 ? 'فائض صرف' : 'متعادل'} tone={net > 0 ? 'green' : net < 0 ? 'red' : undefined}
          hint="سندات القبض ناقص سندات الصرف في الفترة المختارة." />}
        {showCash && <Kpi label="أرصدة الخزائن والبنوك" icon={<Wallet />} value={formatMoney(data?.cash ?? 0)} unit="ج.م" sub={`${data?.cashboxes.length ?? 0} حساب مفعّل ضمن صلاحيتك`}
          hint="الرصيد الحالي للخزائن والحسابات البنكية المفعلة والمسموح بها للمستخدم، ولا يتغير بتغيير الفترة." onClick={() => nav('/cashboxes')} />}
      </div>

      <div className="hk-row">
        {showSales && <div className="hk-card hk-chart-card">
          <div className="hk-card-h"><div><h3>{data?.series.title ?? 'حركة المبيعات'} <Hint side="start" text="الأعمدة تمثل صافي المبيعات بعد المرتجعات في الفترة المختارة، والخط يمثل الفترة السابقة المقابلة. رسم اليوم والبارحة يستخدم وقت إنشاء الفاتورة المسجل محليًا فقط." /></h3><span className="hk-card-sub">{data?.series.compare ?? vs}</span></div>
            <span className="hk-legend"><i className="cur" /> الفترة المختارة <i className="prev" /> السابقة</span></div>
          {data?.series.unavailable ? <div className="hk-unavailable">{data.series.unavailable}</div> : <SalesChart series={data?.series.points ?? []} hasPrevious={data?.series.hasPrevious ?? true} />}
        </div>}
        {(showParties || showStockValue) && <div className="hk-card hk-bal">
          <div className="hk-card-h"><h3>الأرصدة الحالية <Hint side="start" text="أرصدة حالية على بيانات الجهاز ونطاق المستخدم، وليست مقيدة بالفترة المختارة." /></h3></div>
          {showParties && <BalRow icon={<Users />} label="مستحق من العملاء" value={data?.receivables ?? 0} sub={`${data?.debtors ?? 0} عميل عليهم رصيد`} onClick={() => nav('/parties/customer')} hint="أرصدة العملاء المدينة الحالية." />}
          {showParties && <BalRow icon={<ShoppingBag />} label="مستحق للموردين" value={data?.payables ?? 0} sub={`${data?.creditors ?? 0} مورد لهم رصيد`} onClick={() => nav('/parties/supplier')} hint="أرصدة الموردين الحالية." />}
          {showStockValue && <BalRow icon={<Package />} label="قيمة المخزون" value={data?.stockValue ?? 0} sub={`${data?.stockItems ?? 0} صنف له رصيد · بالتكلفة`} onClick={showInventory ? () => nav('/reports/stock') : undefined} hint="قيمة المخزون حسب التكلفة المسجلة في أرصدة الجهاز والمخازن المسموح بها." />}
        </div>}
      </div>

      <div className="hk-detail-grid">
        {showSales && <TopItems items={data?.topItems ?? []} sort={itemSort} onSort={setItemSort} to={can('reports.view') ? '/reports/analysis' : '/docs/list/sales'} />}
        {showCash && <PaymentMix rows={data?.methods ?? []} />}
        {showCash && <CashboxBalances boxes={data?.cashboxes ?? []} onOpen={() => nav('/cashboxes')} />}
        {(showSales || showInventory) && <QuickInsights period={periodLabel} lines={insight} />}
      </div>
    </section>
  );
}

function Kpi({ label, icon, value, unit, change, vs, sub, hint, tone, dark, invert, onClick }: {
  label: string; icon: ReactNode; value: string; unit?: string; change?: number | null; vs?: string; sub?: string; hint: string;
  tone?: 'green' | 'red' | 'orange'; dark?: boolean; invert?: boolean; onClick?: () => void;
}) {
  const good = change != null && (invert ? change <= 0 : change >= 0);
  return (
    <div className={`hk-kpi ${dark ? 'dark' : ''} ${onClick ? 'click' : ''}`}>
      {onClick && <button type="button" className="hk-hit" aria-label={`افتح تفاصيل ${label}`} onClick={onClick} />}
      <span className="hk-kpi-top"><span className="hk-kpi-l">{label} <Hint side="start" text={hint} /></span><span className="hk-kpi-ic">{icon}</span></span>
      <span className="hk-kpi-v"><b className="num">{value}</b>{unit && <small>{unit}</small>}</span>
      <span className="hk-kpi-foot">{change != null ? <span className={`hk-chg ${good ? 'up' : 'down'}`}>{change > 0 ? '+' : ''}{change}% {vs}</span> : null}{sub && <span className={`hk-sub ${tone ?? ''}`}>{sub}</span>}</span>
    </div>
  );
}

function BalRow({ icon, label, value, sub, hint, onClick }: { icon: ReactNode; label: string; value: number; sub: string; hint: string; onClick?: () => void }) {
  return (
    <div className={`hk-bal-row ${onClick ? '' : 'static'}`}>
      {onClick && <button type="button" className="hk-hit" aria-label={`افتح ${label}`} onClick={onClick} />}
      <span className="hk-kpi-ic">{icon}</span><span className="hk-bal-t"><span className="hk-bal-l">{label} <Hint side="start" text={hint} /></span><span className="hk-bal-s">{sub}</span></span><b className="num">{formatMoney(value)}</b>
    </div>
  );
}

function TopItems({ items, sort, onSort, to }: { items: SoldItem[]; sort: 'qty' | 'value'; onSort: (x: 'qty' | 'value') => void; to: string }) {
  const nav = useNavigate();
  const ranked = [...items].sort((a, b) => sort === 'qty' ? b.qty - a.qty : b.value - a.value).slice(0, 5);
  return (
    <section className="hk-card hk-extra-card" aria-labelledby="hk-top-items">
      <div className="hk-card-h"><div><h3 id="hk-top-items">الأكثر مبيعًا <Hint side="start" text="من بنود فواتير البيع والمرتجعات المرحلة في الفترة المختارة. الكمية بوحدة الصنف الأساسية والقيمة من إجمالي السطر المسجل." /></h3><span className="hk-card-sub">{ranked.length ? 'حسب الفواتير المرحلة' : 'لا توجد حركة كافية في الفترة'}</span></div>
        <div className="hk-mini-toggle"><button type="button" className={sort === 'qty' ? 'on' : ''} onClick={() => onSort('qty')}>كمية</button><button type="button" className={sort === 'value' ? 'on' : ''} onClick={() => onSort('value')}>قيمة</button></div></div>
      {ranked.length ? <div className="hk-top-list">{ranked.map((item, i) => {
        const max = Math.max(1, ...ranked.map((x) => sort === 'qty' ? x.qty : x.value));
        const amount = sort === 'qty' ? formatQty(item.qty) : formatMoney(item.value);
        return <button type="button" className="hk-top-item" key={item.id} onClick={() => nav(to)}>
          <span className="hk-top-rank num">{i + 1}</span><span className="hk-top-main"><span className="hk-top-name">{item.name}</span><span className="hk-top-track"><i style={{ width: `${Math.max(4, ((sort === 'qty' ? item.qty : item.value) / max) * 100)}%` }} /></span></span><b className="num">{amount}{sort === 'qty' && item.unit ? <small> {item.unit}</small> : null}</b>
        </button>;
      })}</div> : <div className="hk-detail-empty">لا توجد فواتير بيع مرحلة بها أصناف في الفترة المختارة.</div>}
      <button type="button" className="hk-detail-link" onClick={() => nav(to)}>فتح تحليل المبيعات</button>
    </section>
  );
}

function PaymentMix({ rows }: { rows: MethodSum[] }) {
  const max = Math.max(1, ...rows.map((x) => x.incoming + x.outgoing));
  return <section className="hk-card hk-extra-card" aria-labelledby="hk-paymix">
    <div className="hk-card-h"><div><h3 id="hk-paymix">المدفوعات حسب الوسيلة <Hint side="start" text="تجميع مبالغ الدفع المسجلة في الفواتير والسندات المرحلة، حسب الخزائن النشطة والمتاحة لهذا المستخدم. التحويلات بين الخزائن مستبعدة لتجنب اعتبارها قبضًا أو صرفًا." /></h3><span className="hk-card-sub">للفترة المختارة · بحسب بيانات الدفع الفعلية</span></div></div>
    {rows.length ? <><div className="hk-method-legend"><span><i className="in" /> قبض</span><span><i className="out" /> صرف</span></div><div className="hk-method-list">{rows.map((row) => <div className="hk-method-row" key={row.id}>
      <div className="hk-method-label"><b>{row.name}</b><span className="num">{formatMoney(row.incoming + row.outgoing)}</span></div>
      <div className="hk-method-track"><i className="in" style={{ width: `${(row.incoming / max) * 100}%` }} /><i className="out" style={{ width: `${(row.outgoing / max) * 100}%` }} /></div>
      <div className="hk-method-values"><span>قبض <b className="num">{formatMoney(row.incoming)}</b></span><span>صرف <b className="num">{formatMoney(row.outgoing)}</b></span></div>
    </div>)}</div></> : <div className="hk-detail-empty">لا توجد مدفوعات مسجلة على خزائن مفعّلة في الفترة المختارة.</div>}
  </section>;
}

function CashboxBalances({ boxes, onOpen }: { boxes: BoxSum[]; onOpen: () => void }) {
  return <section className="hk-card hk-extra-card" aria-labelledby="hk-boxes">
    <div className="hk-card-h"><div><h3 id="hk-boxes">أرصدة الخزائن والبنوك <Hint side="start" text="الأرصدة الحالية للخزائن والحسابات البنكية النشطة التي يستطيع المستخدم الوصول إليها، لا تتغير مع اختيار الفترة." /></h3><span className="hk-card-sub">الرصيد الحالي · الحسابات المفعّلة المسموح بها</span></div></div>
    {boxes.length ? <div className="hk-box-list">{boxes.map((box) => <div className="hk-box-row" key={box.id}><span className={`hk-box-ic ${box.kind === 'cash' ? 'cash' : ''}`}><Wallet /></span><span className="hk-box-name">{box.name}</span><b className="num">{formatMoney(box.balance)}</b></div>)}</div> : <div className="hk-detail-empty">لا توجد خزائن أو حسابات مفعّلة ضمن صلاحيتك.</div>}
    <button type="button" className="hk-detail-link" onClick={onOpen}>عرض تفاصيل الخزائن</button>
  </section>;
}

function QuickInsights({ period, lines }: { period: string; lines: string[] }) {
  return <section className="hk-card hk-extra-card" aria-labelledby="hk-insights">
    <div className="hk-card-h"><div><h3 id="hk-insights">ملاحظات سريعة <Hint side="start" text="استنتاجات مبنية على بيانات محلية موثوقة، مع استبعاد المسودات والملغى. لا تظهر ملاحظة مقارنة إذا لم توجد فترة سابقة للمقارنة." /></h3><span className="hk-card-sub">الفترة: {period}</span></div></div>
    {lines.length ? <ul className="hk-insight-list">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : <div className="hk-detail-empty">لا توجد ملاحظات كافية بالأرقام المتاحة للفترة.</div>}
    <div className="hk-insight-source">المصدر: بيانات الفواتير المرحلة وأرصدة المخزون المتاحة على هذا الجهاز.</div>
  </section>;
}

function SalesChart({ series, hasPrevious }: { series: ChartPoint[]; hasPrevious: boolean }) {
  if (!series.length) return null;
  const max = Math.max(1, ...series.flatMap((x) => [x.current, x.previous]).map(Math.abs));
  const step = niceStep(max / 4);
  const ticks = Math.max(1, Math.ceil(max / step));
  const top = step * ticks;
  const W = 700, H = 220, padL = 50, padB = 30, padT = 8;
  const cw = (W - padL) / series.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - Math.max(0, v) / top);
  const x = (i: number) => W - padL - (i + 0.5) * cw;
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v.previous).toFixed(1)}`).join(' ');
  const labelEvery = series.length > 16 ? 4 : series.length > 9 ? 2 : 1;
  return <svg className="hk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`مبيعات الفترة: ${formatMoney(series.reduce((a, b) => a + b.current, 0))}`}>
    {Array.from({ length: ticks + 1 }, (_, k) => <g key={k}><line x1={0} x2={W - padL} y1={y(step * k)} y2={y(step * k)} className="hk-grid-l" /><text x={W - padL + 6} y={y(step * k) + 4} className="hk-axis" textAnchor="start">{axisLabel(step * k)}</text></g>)}
    {series.map((v, i) => { const h = Math.max(1.5, y(0) - y(v.current)); return <rect key={`${v.label}-${i}`} x={x(i) - cw * 0.28} y={y(0) - h} width={Math.max(2, cw * 0.56)} height={h} rx={3} className="hk-bar"><title>{`${v.label}: ${formatMoney(v.current)}${hasPrevious ? ` · الفترة السابقة: ${formatMoney(v.previous)}` : ''}`}</title></rect>; })}
    {hasPrevious && <path d={line} className="hk-prev" />}
    {series.map((v, i) => i % labelEvery === 0 || i === series.length - 1 ? <text key={`${v.label}-label`} x={x(i)} y={H - 8} className="hk-axis" textAnchor="middle">{v.label}</text> : null)}
  </svg>;
}

function axisLabel(v: number) { return formatMoney(Math.round(v)).replace(/\.00$/, ''); }
function niceStep(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
