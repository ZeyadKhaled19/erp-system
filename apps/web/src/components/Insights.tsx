import { formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { HBarList, lastMonths, MonthBars } from './charts';

/** تحليل التعامل مع عميل/مورد (من البيانات المحلية — يعمل دون اتصال) */
export function PartyInsights({ party }: { party: any }) {
  const isCust = party.kind === 'customer';
  const months = lastMonths(12);
  const data = useLiveQuery(async () => {
    const docs = (await db.documents.where('party_id').equals(party.id).toArray()).filter((d) => d.status === 'posted');
    const inv = isCust ? 'sale_invoice' : 'purchase_invoice';
    const ret = isCust ? 'sale_return' : 'purchase_return';
    const invoices = docs.filter((d) => d.doc_type === inv);
    const returns = docs.filter((d) => d.doc_type === ret);
    const total = invoices.reduce((s, d) => s + d.total, 0) - returns.reduce((s, d) => s + d.total, 0);
    const year = todayISO().slice(0, 4);
    const thisYear = invoices.filter((d) => d.date.startsWith(year)).reduce((s, d) => s + d.total, 0) - returns.filter((d) => d.date.startsWith(year)).reduce((s, d) => s + d.total, 0);
    const today = todayISO();
    const open = invoices.filter((d) => !d.closed && d.total > d.paid);
    const overdue = open.filter((d) => d.due_date && d.due_date < today);
    const byMonth = new Map<string, number>();
    for (const d of invoices) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) + d.total);
    for (const d of returns) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) - d.total);
    const items = new Map<string, number>();
    for (const d of invoices) for (const l of await db.document_lines.where('document_id').equals(d.id).toArray()) items.set(l.item_id, (items.get(l.item_id) ?? 0) + (l.total ?? 0));
    const names = new Map((await db.items.bulkGet([...items.keys()])).filter(Boolean).map((i) => [i!.id, i!.name]));
    const top = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => ({ label: names.get(id) ?? '—', value: v }));
    const insts = (await db.instruments.where('party_id').equals(party.id).toArray()).filter((x) => x.status === 'open');
    const last = invoices.map((d) => d.date).sort().at(-1);
    const first = invoices.map((d) => d.date).sort()[0];
    return {
      total, thisYear, count: invoices.length, avg: invoices.length ? Math.round(total / invoices.length) : 0, last, first,
      open: open.reduce((s, d) => s + d.total - d.paid, 0), openCount: open.length,
      overdue: overdue.reduce((s, d) => s + d.total - d.paid, 0), overdueCount: overdue.length,
      insts: insts.reduce((s, x) => s + x.amount, 0), instsCount: insts.length,
      series: months.map((m) => ({ label: m.label, value: byMonth.get(m.key) ?? 0 })),
      top,
      returns: returns.reduce((s, d) => s + d.total, 0),
    };
  }, [party.id]);
  if (!data) return null;
  const daysSince = data.last ? Math.round((Date.now() - new Date(data.last + 'T00:00:00').getTime()) / 86400000) : null;
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="kpis">
        <Kpi label={isCust ? 'إجمالي المشتريات منّا' : 'إجمالي مشترياتنا منه'} value={formatMoney(data.total)} sub={`${data.count} فاتورة`} />
        <Kpi label="هذا العام" value={formatMoney(data.thisYear)} />
        <Kpi label="متوسط الفاتورة" value={formatMoney(data.avg)} />
        <Kpi label="آخر تعامل" value={data.last ?? '—'} sub={daysSince !== null ? (daysSince === 0 ? 'اليوم' : `منذ ${daysSince} يوم`) : undefined} />
        <Kpi label="فواتير غير مسددة" value={formatMoney(data.open)} sub={`${data.openCount} فاتورة`} tone={data.open ? 'orange' : undefined} />
        <Kpi label="متأخر السداد" value={formatMoney(data.overdue)} sub={`${data.overdueCount} فاتورة`} tone={data.overdue ? 'red' : undefined} />
        {data.instsCount > 0 && <Kpi label="شيكات وأقساط مفتوحة" value={formatMoney(data.insts)} sub={`${data.instsCount} بند`} />}
        {data.returns > 0 && <Kpi label="مرتجعات" value={formatMoney(data.returns)} />}
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="chart-card">
          <div className="bold">التعامل الشهري (آخر 12 شهرًا)</div>
          <MonthBars data={data.series} />
        </div>
        <div className="chart-card">
          <div className="bold" style={{ marginBottom: 8 }}>{isCust ? 'أكثر الأصناف شراءً' : 'أكثر الأصناف توريدًا'}</div>
          <HBarList rows={data.top} />
        </div>
      </div>
    </div>
  );
}

/** تحليل أداء صنف: المبيعات والربح والحركة الشهرية وأكبر العملاء */
export function ItemInsights({ item }: { item: any }) {
  const can = usePerm();
  const months = lastMonths(12);
  const data = useLiveQuery(async () => {
    const lines = await db.document_lines.where('item_id').equals(item.id).toArray();
    const docIds = [...new Set(lines.map((l) => l.document_id))];
    const docs = new Map((await db.documents.bulkGet(docIds)).filter(Boolean).map((d) => [d!.id, d!]));
    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    const s30 = todayISO(since30);
    let qty30 = 0, rev30 = 0, qtyAll = 0, revAll = 0, costAll = 0;
    let lastSale: string | undefined, lastBuy: any;
    const byMonth = new Map<string, number>();
    const byCust = new Map<string, number>();
    for (const l of lines) {
      const d = docs.get(l.document_id);
      if (!d || d.status !== 'posted') continue;
      const net = (l.total ?? 0) - (l.tax ?? 0);
      if (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return') {
        const sg = d.doc_type === 'sale_invoice' ? 1 : -1;
        qtyAll += sg * l.base_qty;
        revAll += sg * net;
        costAll += sg * (l.cost ?? 0);
        if (d.date >= s30) {
          qty30 += sg * l.base_qty;
          rev30 += sg * net;
        }
        byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) + sg * net);
        if (d.party_id && d.party_id !== 'party-cash-customer') byCust.set(d.party_id, (byCust.get(d.party_id) ?? 0) + sg * net);
        if (sg > 0 && (!lastSale || d.date > lastSale)) lastSale = d.date;
      }
      if (d.doc_type === 'purchase_invoice' && (!lastBuy || d.date > lastBuy.date)) lastBuy = { date: d.date, price: l.qty ? Math.round(((l.total - l.tax) * 1000) / l.qty) : l.price, unit: l.unit_name };
    }
    const names = new Map((await db.parties.bulkGet([...byCust.keys()])).filter(Boolean).map((p) => [p!.id, p!.name]));
    const top = [...byCust.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => ({ label: names.get(id) ?? '—', value: v }));
    const bal = (await db.stock_balances.where('item_id').equals(item.id).toArray()).reduce((s, b) => s + b.qty, 0);
    const daily = qty30 / 30;
    return {
      qty30, rev30, qtyAll, revAll, costAll, lastSale, lastBuy, top,
      series: months.map((m) => ({ label: m.label, value: byMonth.get(m.key) ?? 0 })),
      avgPrice: qtyAll ? Math.round((revAll * 1000) / qtyAll) : 0,
      cover: daily > 0 ? Math.floor(bal / daily) : null,
    };
  }, [item.id]);
  if (!data) return null;
  const profit = data.revAll - data.costAll;
  const margin = data.revAll ? Math.round((profit * 1000) / data.revAll) / 10 : 0;
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="kpis">
        <Kpi label="مبيعات آخر 30 يومًا" value={formatMoney(data.rev30)} sub={`${formatQty(data.qty30)} ${item.base_unit}`} />
        <Kpi label="إجمالي المبيعات" value={formatMoney(data.revAll)} sub={`${formatQty(data.qtyAll)} ${item.base_unit}`} />
        <Kpi label="متوسط سعر البيع الفعلي" value={formatMoney(data.avgPrice)} />
        {can('reports.profit') && <Kpi label="مجمل الربح" value={formatMoney(profit)} sub={`هامش ${margin}%`} tone={profit < 0 ? 'red' : 'green'} />}
        <Kpi label="آخر بيع" value={data.lastSale ?? '—'} />
        {can('costs.view') && <Kpi label="آخر شراء" value={data.lastBuy?.date ?? '—'} sub={data.lastBuy ? `بسعر ${formatMoney(data.lastBuy.price)} / ${data.lastBuy.unit}` : undefined} />}
        {data.cover !== null && <Kpi label="الرصيد يكفي (يوم)" value={String(data.cover)} sub="حسب معدل بيع آخر 30 يومًا" tone={data.cover < 7 ? 'orange' : undefined} />}
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="chart-card">
          <div className="bold">المبيعات الشهرية</div>
          <MonthBars data={data.series} />
        </div>
        <div className="chart-card">
          <div className="bold" style={{ marginBottom: 8 }}>أكبر العملاء لهذا الصنف</div>
          <HBarList rows={data.top} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'orange' | 'green' }) {
  return (
    <div className="kpi">
      <div className="k-label">{label}</div>
      <div className={`k-value num ${tone ?? ''}`}>{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}
