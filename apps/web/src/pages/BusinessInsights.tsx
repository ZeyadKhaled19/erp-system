import { formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, AlertTriangle, ArrowDownRight, ChartNoAxesCombined, CircleCheck, FileText, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { setDocTitle } from '../lib/brand';
import { usePerm, useSession } from '../lib/hooks';

type Period = '7d' | '30d' | '90d' | 'year';
type Tone = 'good' | 'watch' | 'neutral';
type Insight = { area: string; title: string; finding: string; action: string; metric: string; tone: Tone; source: string; to?: string; perm?: string };
const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: 'آخر 7 أيام' },
  { key: '30d', label: 'آخر 30 يوم' },
  { key: '90d', label: 'آخر 90 يوم' },
  { key: 'year', label: 'من بداية السنة' },
];
const iso = (date: Date) => todayISO(date);
const shiftDay = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };

function rangeFor(period: Period) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (period === 'year') {
    const from = new Date(today.getFullYear(), 0, 1, 12);
    const prevFrom = new Date(today.getFullYear() - 1, 0, 1, 12);
    const prevTo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate(), 12);
    return { from: iso(from), to: iso(today), prevFrom: iso(prevFrom), prevTo: iso(prevTo), days: Math.floor((today.getTime() - from.getTime()) / 86400000) + 1 };
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = shiftDay(today, 1 - days);
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(prevTo, 1 - days);
  return { from: iso(from), to: iso(today), prevFrom: iso(prevFrom), prevTo: iso(prevTo), days };
}

const pctChange = (current: number, previous: number) => previous ? ((current - previous) * 100) / Math.abs(previous) : null;
const posted = (doc: any) => doc.status === 'posted';
const netSales = (docs: any[]) => docs.reduce((total, doc) => total + (doc.doc_type === 'sale_invoice' ? 1 : -1) * (doc.total ?? 0), 0);

export function BusinessInsightsPage() {
  const can = usePerm();
  const nav = useNavigate();
  const { session } = useSession();
  const [period, setPeriod] = useState<Period>('30d');
  const [warehouseId, setWarehouseId] = useState('');
  const dates = useMemo(() => rangeFor(period), [period]);
  const canSales = can('sales.view');
  const canProfit = can('costs.view') || can('reports.profit');
  const canInventory = can('inventory.view');
  const canItems = can('items.view') || canInventory;
  const canPurchases = can('purchases.view');
  const canTreasury = can('treasury.view');
  const canParties = can('parties.view');
  const canEmployees = can('employees.view');
  const permissionsKey = session.user.permissions.join(',');
  const warehouseScopeKey = (session.user.warehouse_ids ?? []).join(',');
  const warehouses = useLiveQuery(async () => {
    if (!canInventory) return [];
    const allowed = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
    return (await db.warehouses.toArray()).filter((w) => w.active !== false && (!allowed || allowed.has(w.id))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  }, [canInventory, warehouseScopeKey]);
  const selectedWarehouse = warehouseId && (warehouses ?? []).some((w) => w.id === warehouseId) ? warehouseId : '';

  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'نبض المحل';
    setDocTitle('نبض المحل');
  }, []);

  const data = useLiveQuery(async () => {
    const types = [
      ...(canSales ? ['sale_invoice', 'sale_return'] : []),
      ...(canPurchases ? ['purchase_invoice', 'purchase_return'] : []),
      ...(canTreasury ? ['receipt', 'income', 'payment', 'expense'] : []),
      ...(!canTreasury && canProfit ? ['expense'] : []),
    ];
    const batches = await Promise.all(types.map((type) => db.documents.where('[doc_type+date]').between([type, dates.prevFrom], [type, dates.to], true, true).toArray()));
    const all = batches.flat().filter(posted).filter((doc) => {
      if (!selectedWarehouse) return true;
      if (['sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return'].includes(doc.doc_type)) return doc.warehouse_id === selectedWarehouse;
      return true;
    });
    const current = all.filter((doc) => doc.date >= dates.from && doc.date <= dates.to);
    const previous = all.filter((doc) => doc.date >= dates.prevFrom && doc.date <= dates.prevTo);
    const currentSales = current.filter((doc) => doc.doc_type === 'sale_invoice' || doc.doc_type === 'sale_return');
    const previousSales = previous.filter((doc) => doc.doc_type === 'sale_invoice' || doc.doc_type === 'sale_return');
    const saleInvoices = currentSales.filter((doc) => doc.doc_type === 'sale_invoice');
    const previousInvoices = previousSales.filter((doc) => doc.doc_type === 'sale_invoice');
    const saleReturns = currentSales.filter((doc) => doc.doc_type === 'sale_return');
    const sumType = (docs: any[], type: string) => docs.filter((doc) => doc.doc_type === type).reduce((sum, doc) => sum + (doc.total ?? 0), 0);
    const profit = (docs: any[]) => {
      const sales = docs.filter((doc) => doc.doc_type === 'sale_invoice' || doc.doc_type === 'sale_return');
      return { known: sales.length > 0 && sales.every((doc) => doc.cost != null), value: sales.reduce((sum, doc) => sum + (doc.doc_type === 'sale_invoice' ? 1 : -1) * ((doc.total ?? 0) - (doc.tax ?? 0) - (doc.cost ?? 0)), 0) };
    };
    const currentProfit = profit(currentSales);
    const previousProfit = profit(previousSales);

    let topItems: { id: string; name: string; qty: number; value: number; returned: number }[] = [];
    let items: any[] = [];
    let stockRows: any[] = [];
    let lowStock: any[] = [];
    let idleStock: any[] = [];
    if (canItems) items = (await db.items.toArray()).filter((item) => item.active !== false && !item.is_service);
    if (canInventory) {
      const balances = await db.stock_balances.toArray();
      const allowedWarehouses = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
      stockRows = balances.filter((row) => (!allowedWarehouses || allowedWarehouses.has(row.warehouse_id)) && (!selectedWarehouse || row.warehouse_id === selectedWarehouse));
    }
    const salesDocIds = currentSales.map((doc) => doc.id);
    const salesLines = salesDocIds.length ? await db.document_lines.where('document_id').anyOf(salesDocIds).toArray() : [];
    if (canItems && salesLines.length) {
      const signByDoc = new Map(currentSales.map((doc) => [doc.id, doc.doc_type === 'sale_invoice' ? 1 : -1]));
      const rollup = new Map<string, { qty: number; value: number; returned: number }>();
      for (const line of salesLines) {
        const sign = signByDoc.get(line.document_id) ?? 1;
        const row = rollup.get(line.item_id) ?? { qty: 0, value: 0, returned: 0 };
        row.qty += sign * (line.base_qty ?? line.qty ?? 0);
        row.value += sign * (line.total ?? 0);
        if (sign < 0) row.returned += line.base_qty ?? line.qty ?? 0;
        rollup.set(line.item_id, row);
      }
      const itemRows = await db.items.bulkGet([...rollup.keys()]);
      const itemMap = new Map(itemRows.filter(Boolean).map((item: any) => [item.id, item]));
      topItems = [...rollup.entries()].map(([id, value]) => ({ id, name: itemMap.get(id)?.name ?? 'صنف غير معروف', ...value })).filter((item) => item.qty > 0).sort((a, b) => b.value - a.value).slice(0, 5);
    }
    if (canInventory) {
      const qtyByItem = new Map<string, number>();
      const valueByItem = new Map<string, number>();
      for (const row of stockRows) {
        qtyByItem.set(row.item_id, (qtyByItem.get(row.item_id) ?? 0) + (row.qty ?? 0));
        valueByItem.set(row.item_id, (valueByItem.get(row.item_id) ?? 0) + (row.value ?? 0));
      }
      lowStock = items.filter((item) => item.reorder_level > 0 && (qtyByItem.get(item.id) ?? 0) <= item.reorder_level)
        .map((item) => ({ id: item.id, name: item.name, qty: qtyByItem.get(item.id) ?? 0, min: item.reorder_level }))
        .sort((a, b) => a.qty - b.qty).slice(0, 8);
      const moved = new Set(salesLines.map((line) => line.item_id));
      idleStock = items.filter((item) => (qtyByItem.get(item.id) ?? 0) > 0 && !moved.has(item.id))
        .map((item) => ({ id: item.id, name: item.name, qty: qtyByItem.get(item.id) ?? 0, value: valueByItem.get(item.id) ?? 0 }))
        .sort((a, b) => b.value - a.value).slice(0, 8);
    }

    const expenses = sumType(current, 'expense');
    const previousExpenses = sumType(previous, 'expense');
    const purchases = sumType(current, 'purchase_invoice') - sumType(current, 'purchase_return');
    const previousPurchases = sumType(previous, 'purchase_invoice') - sumType(previous, 'purchase_return');
    const receipts = sumType(current, 'receipt') + sumType(current, 'income');
    const payments = sumType(current, 'payment') + sumType(current, 'expense');
    let overdue = { count: 0, value: 0 };
    if (canSales) {
      const openSales = (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter((doc) => posted(doc) && !doc.closed && (doc.total ?? 0) > (doc.paid ?? 0));
      const today = todayISO();
      overdue = openSales.filter((doc) => doc.due_date && doc.due_date < today).reduce((total, doc) => ({ count: total.count + 1, value: total.value + Math.max(0, (doc.total ?? 0) - (doc.paid ?? 0)) }), { count: 0, value: 0 });
    }
    let customerBalance = 0;
    if (canParties) customerBalance = (await db.parties.toArray()).filter((party) => party.kind === 'customer' && (party.balance ?? 0) > 0).reduce((sum, party) => sum + (party.balance ?? 0), 0);

    let attendance = { present: 0, late: 0, absent: 0, leave: 0, total: 0 };
    let previousAttendance = { present: 0, late: 0, absent: 0, leave: 0, total: 0 };
    if (canEmployees) {
      const [currentRows, previousRows] = await Promise.all([
        db.attendance.where('date').between(dates.from, dates.to, true, true).toArray(),
        db.attendance.where('date').between(dates.prevFrom, dates.prevTo, true, true).toArray(),
      ]);
      const count = (rows: any[]) => ({ present: rows.filter((row) => row.status === 'present').length, late: rows.filter((row) => row.status === 'late').length, absent: rows.filter((row) => row.status === 'absent').length, leave: rows.filter((row) => row.status === 'leave').length, total: rows.length });
      attendance = count(currentRows);
      previousAttendance = count(previousRows);
    }
    return {
      currentSales: netSales(currentSales), previousSales: netSales(previousSales), saleInvoices: saleInvoices.length,
      previousInvoices: previousInvoices.length, averageInvoice: saleInvoices.length ? netSales(currentSales) / saleInvoices.length : 0,
      previousAverage: previousInvoices.length ? netSales(previousSales) / previousInvoices.length : 0,
      grossSales: sumType(currentSales, 'sale_invoice'), returns: sumType(currentSales, 'sale_return'), previousReturns: sumType(previousSales, 'sale_return'),
      currentProfit, previousProfit, expenses, previousExpenses, purchases, previousPurchases, receipts, payments,
      overdue, customerBalance, attendance, previousAttendance, topItems, lowStock, idleStock,
      salesLinesCount: salesLines.length, salesDocsCount: currentSales.length, itemCount: items.length,
    };
  }, [dates.from, dates.to, dates.prevFrom, dates.prevTo, selectedWarehouse, permissionsKey, warehouseScopeKey, session.user.id]);

  const insights = useMemo((): Insight[] => {
    if (!data) return [];
    const rows: Insight[] = [];
    const salesDelta = pctChange(data.currentSales, data.previousSales);
    if (canSales) {
      if (salesDelta != null && data.saleInvoices > 0) {
        const up = salesDelta >= 0;
        rows.push({ area: 'المبيعات', title: 'اتجاه المبيعات', metric: `${up ? '+' : ''}${salesDelta.toFixed(1)}%`, tone: up ? 'good' : 'watch', finding: `صافي المبيعات ${up ? 'زاد' : 'انخفض'} ${Math.abs(salesDelta).toFixed(1)}% مقارنة بالفترة السابقة؛ ${formatMoney(data.currentSales)} مقابل ${formatMoney(data.previousSales)}.`, action: up ? 'راجع الأصناف التي ساهمت في الزيادة وحافظ على توفرها.' : 'راجع الأصناف التي فقدت مبيعاتها وحركة العملاء خلال الفترة.', source: `${data.saleInvoices} فاتورة بيع و${data.salesDocsCount - data.saleInvoices} مرتجع مرحّل`, to: can('reports.view') ? '/reports/analysis' : '/docs/list/sales', perm: can('reports.view') ? 'reports.view' : 'sales.view' });
      } else if (data.saleInvoices > 0) {
        rows.push({ area: 'المبيعات', title: 'حجم البيع', metric: formatMoney(data.currentSales), tone: 'neutral', finding: `سُجل ${data.saleInvoices} فاتورة بيع في الفترة. لا توجد مبيعات في الفترة السابقة تكفي لحساب نسبة تغير موثوقة.`, action: 'استمر في تسجيل الفواتير؛ ستظهر المقارنة عندما تتوفر بيانات للفترتين.', source: `${data.saleInvoices} فاتورة بيع مرحّلة`, to: '/docs/list/sales', perm: 'sales.view' });
      } else {
        rows.push({ area: 'المبيعات', title: 'حركة البيع', metric: 'لا توجد فواتير', tone: 'neutral', finding: 'لا توجد فواتير بيع أو مرتجعات مرحلة في الفترة المختارة.', action: 'وسّع الفترة أو راجع سجل المبيعات إذا كنت تتوقع وجود حركة.', source: 'الفواتير المرحلة على هذا الجهاز', to: '/docs/list/sales', perm: 'sales.view' });
      }
      if (data.saleInvoices > 0 && data.previousInvoices > 0) {
        const averageDelta = pctChange(data.averageInvoice, data.previousAverage);
        if (averageDelta != null) rows.push({ area: 'المبيعات', title: 'متوسط قيمة الفاتورة', metric: formatMoney(data.averageInvoice), tone: averageDelta >= 0 ? 'good' : 'watch', finding: `متوسط الفاتورة ${averageDelta >= 0 ? 'ارتفع' : 'انخفض'} ${Math.abs(averageDelta).toFixed(1)}% عن الفترة السابقة.`, action: 'قارن عدد الأصناف في الفاتورة والعروض والخصومات بين الفترتين.', source: `${data.saleInvoices} فاتورة حالية مقابل ${data.previousInvoices} سابقًا`, to: '/docs/list/sales', perm: 'sales.view' });
      }
      if (data.grossSales > 0 && data.returns > 0) {
        const rate = data.returns * 100 / data.grossSales;
        const priorRate = data.previousSales + data.previousReturns > 0 ? data.previousReturns * 100 / (data.previousSales + data.previousReturns) : null;
        rows.push({ area: 'المبيعات', title: 'نسبة المرتجعات', metric: `${rate.toFixed(1)}%`, tone: priorRate != null && rate > priorRate ? 'watch' : 'neutral', finding: `المرتجعات بلغت ${formatMoney(data.returns)} من إجمالي بيع ${formatMoney(data.grossSales)}.${priorRate != null ? ` وكانت ${priorRate.toFixed(1)}% في الفترة السابقة.` : ''}`, action: 'راجع أسباب المرتجعات والأصناف الأكثر تكرارًا قبل إعادة الطلب.', source: 'فواتير البيع والمرتجعات المرحلة', to: '/docs/list/sales', perm: 'sales.view' });
      }
      if (data.topItems.length && data.currentSales > 0) {
        const item = data.topItems[0];
        const share = Math.max(0, item.value) * 100 / data.currentSales;
        rows.push({ area: 'الأصناف', title: 'أكثر صنف يساهم في البيع', metric: `${share.toFixed(1)}%`, tone: share >= 40 ? 'watch' : 'good', finding: `${item.name} هو الأعلى قيمةً في الفترة بقيمة ${formatMoney(item.value)} وبكمية ${formatQty(item.qty)}؛ ويمثل نحو ${share.toFixed(1)}% من صافي البيع.`, action: share >= 40 ? 'تأكد من وجود بدائل وتوفر رصيد كافٍ حتى لا يعتمد البيع على صنف واحد.' : 'راقب رصيده واستمر في مقارنة مساهمته بباقي الأصناف.', source: `${data.salesLinesCount} سطر صنف في الفواتير والمرتجعات`, to: can('reports.view') ? '/reports/analysis' : undefined, perm: can('reports.view') ? 'reports.view' : 'items.view' });
      }
      if (canProfit) {
        const profitPerm = can('reports.profit') ? 'reports.profit' : 'costs.view';
        if (data.currentProfit.known && data.previousProfit.known && data.currentSales > 0 && data.previousSales > 0) {
          const margin = data.currentProfit.value * 100 / data.currentSales;
          const prevMargin = data.previousProfit.value * 100 / data.previousSales;
          const delta = margin - prevMargin;
          rows.push({ area: 'الربحية', title: 'هامش الربح المسجل', metric: `${margin.toFixed(1)}%`, tone: delta >= 0 ? 'good' : 'watch', finding: `هامش الربح ${delta >= 0 ? 'تحسن' : 'تراجع'} ${Math.abs(delta).toFixed(1)} نقطة مئوية مقارنة بالفترة السابقة، وقيمة الربح ${formatMoney(data.currentProfit.value)}.`, action: delta < 0 ? 'راجع تكلفة الأصناف والخصومات التي انخفض هامشها.' : 'حدد الأصناف التي رفعت الهامش وحافظ على توفرها.', source: 'تكلفة البضاعة المسجلة وقت ترحيل الفواتير والمرتجعات', to: can('reports.profit') ? '/reports/income' : undefined, perm: profitPerm });
        } else if (!data.currentProfit.known && data.saleInvoices > 0) {
          rows.push({ area: 'الربحية', title: 'الربح غير مكتمل', metric: 'بيانات تكلفة ناقصة', tone: 'watch', finding: 'بعض فواتير الفترة لا تحتوي على تكلفة فعلية مسجلة، لذلك لا يمكن تقديم تحليل ربح موثوق لها.', action: 'راجع سجل تكلفة الأصناف أو افتح تقرير الأرباح لمعرفة المستندات غير المكتملة.', source: 'حقل تكلفة المستندات المرحلة', to: can('reports.profit') ? '/reports/income' : undefined, perm: profitPerm });
        }
      }
    }
    if (canInventory) {
      if (data.lowStock.length) rows.push({ area: 'المخزون', title: 'أصناف تحتاج مراجعة رصيدها', metric: `${data.lowStock.length} أصناف`, tone: 'watch', finding: `وجدت ${data.lowStock.length} أصناف عند حد الطلب أو أقل في المخزن المحدد، منها: ${data.lowStock.slice(0, 3).map((item) => `${item.name} (${formatQty(item.qty)} متاح)`).join('، ')}.`, action: 'راجع الكميات المطلوبة وحوّل رصيدًا من مخزن آخر إذا كان متاحًا قبل إنشاء طلب شراء.', source: 'الرصيد الحالي وحد الطلب المسجل لكل صنف', to: '/reports/reorder', perm: 'inventory.view' });
      if (data.idleStock.length) {
        const idleValue = data.idleStock.reduce((sum, item) => sum + item.value, 0);
        rows.push({ area: 'المخزون', title: 'رصيد بلا حركة بيع', metric: `${data.idleStock.length} أصناف`, tone: 'neutral', finding: `${data.idleStock.length} أصناف لها رصيد حالي ولم تظهر في فواتير البيع خلال الفترة. قيمة الرصيد المسجلة لها ${formatMoney(idleValue)}.`, action: `ابدأ بمراجعة ${data.idleStock.slice(0, 3).map((item) => item.name).join('، ')}؛ فكّر في نقلها لمخزن أنشط أو عرضها للعملاء.`, source: 'أرصدة المخازن المسموح بها مقابل سطور البيع المرحلة', to: '/reports/stock', perm: 'inventory.view' });
      }
      if (!data.lowStock.length && !data.idleStock.length && data.itemCount > 0) rows.push({ area: 'المخزون', title: 'حركة المخزون', metric: 'لا توجد إشارة واضحة', tone: 'good', finding: 'لم تظهر أصناف عند حد الطلب أو بأرصدة بلا حركة بيع خلال الفترة المختارة.', action: 'استمر في متابعة حد الطلب عند تغير حجم المبيعات.', source: `${data.itemCount} صنف نشط وأرصدة المخازن المسموح بها`, to: '/reports/stock', perm: 'inventory.view' });
    }
    if (canSales && data.overdue.count > 0) rows.push({ area: 'التحصيل', title: 'فواتير متأخرة عن موعدها', metric: `${data.overdue.count} فواتير`, tone: 'watch', finding: `هناك ${data.overdue.count} فواتير بيع متأخرة بإجمالي متبقٍ ${formatMoney(data.overdue.value)}. هذا رصيد حالي، ولا يتغير باختيار الفترة.`, action: 'ابدأ بأقدم فاتورة وتواصل مع العميل لتحديد موعد تحصيل.', source: 'فواتير البيع المرحلة التي تجاوزت تاريخ الاستحقاق', to: '/receivables', perm: 'sales.view' });
    if (canParties && data.customerBalance > 0) rows.push({ area: 'التحصيل', title: 'أرصدة العملاء المدينة', metric: formatMoney(data.customerBalance), tone: 'neutral', finding: 'إجمالي أرصدة العملاء المدينة الحالي. يشمل الأرصدة المفتوحة ولا يقتصر على الفترة المختارة.', action: 'راجع كشف حساب العملاء وحدد المبالغ المستحقة للتحصيل.', source: 'الأرصدة الحالية للعملاء المسجلين', to: '/parties/customer', perm: 'parties.view' });
    if (canTreasury && (data.receipts > 0 || data.payments > 0)) {
      const net = data.receipts - data.payments;
      rows.push({ area: 'السيولة', title: 'صافي حركة السندات', metric: formatMoney(net), tone: net >= 0 ? 'good' : 'watch', finding: `${net >= 0 ? 'القبض أعلى' : 'الصرف أعلى'} من الصرف/القبض بمقدار ${formatMoney(Math.abs(net))} في الفترة.`, action: net < 0 ? 'راجع المدفوعات الكبيرة ومواعيد الالتزامات القادمة.' : 'وازن بين الفائض الحالي والالتزامات المستحقة.', source: 'سندات القبض والإيراد ناقص سندات الصرف والمصروفات المرحلة', to: '/reports/treasury', perm: 'treasury.view' });
    }
    if ((canPurchases || canProfit) && data.purchases > 0 && data.currentSales > 0) {
      const ratio = data.purchases * 100 / data.currentSales;
      const prevRatio = data.previousSales > 0 ? data.previousPurchases * 100 / data.previousSales : null;
      if (prevRatio != null) rows.push({ area: 'المشتريات', title: 'المشتريات مقارنة بالمبيعات', metric: `${ratio.toFixed(1)}%`, tone: ratio > prevRatio ? 'watch' : 'neutral', finding: `المشتريات المرحلة تساوي ${ratio.toFixed(1)}% من صافي المبيعات، مقابل ${prevRatio.toFixed(1)}% في الفترة السابقة.`, action: 'قارن الزيادة بحركة المخزون؛ قد تعني بناء رصيد أو تراجعًا في تصريف الأصناف.', source: 'فواتير المشتريات والمرتجعات ومبيعات الفترة نفسها', to: canPurchases ? '/docs/list/purchases' : undefined, perm: canPurchases ? 'purchases.view' : 'reports.profit' });
    }
    if ((canProfit || canTreasury) && data.currentSales > 0 && data.expenses > 0) {
      const ratio = data.expenses * 100 / data.currentSales;
      const prevRatio = data.previousSales > 0 ? data.previousExpenses * 100 / data.previousSales : null;
      if (prevRatio != null) {
        const rising = ratio > prevRatio;
        rows.push({ area: 'المصروفات', title: 'حصة المصروفات من البيع', metric: `${ratio.toFixed(1)}%`, tone: rising ? 'watch' : 'good', finding: `المصروفات المسجلة تمثل ${ratio.toFixed(1)}% من صافي المبيعات، مقارنة بـ${prevRatio.toFixed(1)}% في الفترة السابقة.`, action: rising ? 'راجع بنود المصروفات التي زادت، وحدد إن كانت مؤقتة أو متكررة.' : 'استمر في متابعة البنود التي حافظت على انخفاضها.', source: 'المصروفات المرحلة مقارنة بصافي المبيعات', to: canProfit ? (can('reports.profit') ? '/reports/income' : undefined) : '/reports/treasury', perm: canProfit ? (can('reports.profit') ? 'reports.profit' : 'costs.view') : 'treasury.view' });
      }
    }
    if (canEmployees && data.attendance.total > 0) {
      const currentLateRate = data.attendance.late * 100 / data.attendance.total;
      const previousLateRate = data.previousAttendance.total ? data.previousAttendance.late * 100 / data.previousAttendance.total : null;
      if (previousLateRate != null) {
        const delta = currentLateRate - previousLateRate;
        rows.push({ area: 'الموظفون', title: 'معدل التأخير المسجل', metric: `${currentLateRate.toFixed(1)}%`, tone: delta > 0 ? 'watch' : 'good', finding: `سجلات التأخير تمثل ${currentLateRate.toFixed(1)}% من سجلات الحضور، مقابل ${previousLateRate.toFixed(1)}% في الفترة السابقة.`, action: delta > 0 ? 'راجع أيام وفترات التأخير مع المسؤول عن الحضور.' : 'استمر في متابعة الانضباط بنفس طريقة التسجيل.', source: `${data.attendance.total} سجل حضور حالي و${data.previousAttendance.total} سابق`, to: '/employees/attendance-report', perm: 'employees.view' });
      }
    }
    return rows;
  }, [data, canSales, canProfit, canInventory, canItems, canPurchases, canTreasury, canParties, canEmployees]);

  const visibleInsights = insights.filter((insight) => !insight.perm || can(insight.perm));
  const areas = [...new Set(visibleInsights.map((insight) => insight.area))];
  const periodLabel = PERIODS.find((item) => item.key === period)?.label ?? '';

  return (
    <div className="page bi-page">
      <div className="bi-hero">
        <span className="bi-hero-icon"><Sparkles /></span>
        <div><h1>نبض المحل</h1><p>تحليل مباشر يشرح التغيّر، يلفت نظرك للمخاطر، ويقترح الخطوة التالية من بياناتك المسجلة.</p></div>
      </div>

      <div className="bi-filterbar">
        <div><b>الفترة: {periodLabel}</b><span>مقارنة بفترة سابقة مساوية في المدة · يعتمد التحليل على المستندات المرحلة.</span></div>
        <div className="bi-filters">
          <label>الفترة<select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          {canInventory && <label>المخزن<select className="select" value={selectedWarehouse} onChange={(event) => setWarehouseId(event.target.value)}><option value="">كل المخازن المسموحة</option>{(warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}
        </div>
      </div>

      <section className="bi-analysis" aria-labelledby="bi-analysis-title">
        <div className="bi-analysis-head">
          <div><h2 id="bi-analysis-title"><ChartNoAxesCombined /> قراءة بيانات الفترة</h2><p>كل ملاحظة تشرح ما تغيّر وتقترح إجراءً مرتبطًا بمصدر البيانات.</p></div>
          <span className="bi-live"><i /> تحليل محلي مباشر</span>
        </div>
        {!data ? <div className="bi-empty">جارٍ تحليل بيانات الجهاز…</div> : visibleInsights.length === 0 ? (
          <div className="bi-empty"><CircleCheck /> مفيش مؤشرات كفاية للفترة دي. اختار فترة أطول أو راجع تسجيل الفواتير والحركات.</div>
        ) : (
          <>
            <div className="bi-summary">
              <div className="bi-summary-icon"><Activity /></div>
              <div><b>الخلاصة للفترة</b><p>{visibleInsights.filter((insight) => insight.tone === 'watch').length ? `في ${visibleInsights.filter((insight) => insight.tone === 'watch').length} نقطة تستحق المراجعة.` : 'لم تظهر مخاطر واضحة في البيانات المتاحة.'} {visibleInsights.filter((insight) => insight.tone === 'good').length ? `وظهر ${visibleInsights.filter((insight) => insight.tone === 'good').length} مؤشر إيجابي.` : ''}</p></div>
            </div>
            <div className="bi-insight-groups">
              {areas.map((area) => <section className="bi-insight-area" key={area}>
                <h3>{area}</h3>
                <div className="bi-insight-list">
                  {visibleInsights.filter((insight) => insight.area === area).map((insight) => <article className={`bi-insight ${insight.tone}`} key={insight.title}>
                    <div className="bi-insight-top"><span className="bi-insight-symbol">{insight.tone === 'watch' ? <AlertTriangle /> : insight.tone === 'good' ? <CircleCheck /> : <Sparkles />}</span><div className="bi-insight-title"><h4>{insight.title}</h4><b>{insight.metric}</b></div></div>
                    <p className="bi-finding">{insight.finding}</p>
                    <div className="bi-action"><b>الخطوة المقترحة</b><span>{insight.action}</span></div>
                    <div className="bi-insight-foot"><small>المصدر: {insight.source}</small>{insight.to && <button type="button" onClick={() => nav(insight.to!)}>افتح التفاصيل <ArrowDownRight /></button>}</div>
                  </article>)}
                </div>
              </section>)}
            </div>
          </>
        )}
      </section>
      <div className="bi-note"><FileText /> لا نعرض استنتاجًا عند غياب البيانات الكافية. الأرباح تحتاج تكلفة مسجلة، والمخزون يستخدم مخازن المستخدم المسموح بها، والفرع غير متاح لأن النظام لا يسجل فروعًا مستقلة.</div>
    </div>
  );
}
