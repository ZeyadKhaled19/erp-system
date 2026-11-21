import { formatMoney, formatQty, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, AlertTriangle, ArrowDownRight, BadgeDollarSign, Boxes, BriefcaseBusiness, CircleHelp, ClipboardList, PackageSearch, ShoppingBasket, Store, Truck, Users, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { setDocTitle } from '../lib/brand';
import { usePerm, useSession } from '../lib/hooks';

type Period = '7d' | '30d' | '90d' | 'year';
type Entry = { name: string; value: string; note?: string; tone?: 'good' | 'watch' | 'neutral'; to?: string; perm?: string };
type AnalysisSection = { id: string; label: string; icon: typeof Store; headline: string; summary: string; entries: Entry[]; permission?: string };
const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: 'آخر 7 أيام' }, { key: '30d', label: 'آخر 30 يوم' }, { key: '90d', label: 'آخر 90 يوم' }, { key: 'year', label: 'من بداية السنة' },
];
const asISO = (date: Date) => todayISO(date);
const shiftDay = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
function rangeFor(period: Period) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  if (period === 'year') {
    const from = new Date(today.getFullYear(), 0, 1, 12); const prevFrom = new Date(today.getFullYear() - 1, 0, 1, 12); const prevTo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate(), 12);
    return { from: asISO(from), to: asISO(today), prevFrom: asISO(prevFrom), prevTo: asISO(prevTo) };
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90; const from = shiftDay(today, 1 - days); const prevTo = shiftDay(from, -1); const prevFrom = shiftDay(prevTo, 1 - days);
  return { from: asISO(from), to: asISO(today), prevFrom: asISO(prevFrom), prevTo: asISO(prevTo) };
}
const posted = (doc: any) => doc.status === 'posted';
const pctChange = (current: number, previous: number) => previous ? (current - previous) * 100 / Math.abs(previous) : null;
const signedTotal = (docs: any[], types: string[]) => docs.reduce((sum, doc) => sum + (types.includes(doc.doc_type) ? (doc.doc_type.endsWith('return') ? -1 : 1) * ((doc.total ?? 0) - (doc.tax ?? 0)) : 0), 0);
const since = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - days); return asISO(d); };
const routeFor = (docType: string) => docType.startsWith('sale') ? '/docs/list/sales' : docType.startsWith('purchase') ? '/docs/list/purchases' : '/docs/list';
const daysBetween = (a: string, b: string) => Math.max(1, Math.floor((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000) + 1);

export function BusinessInsightsPage() {
  const can = usePerm(); const nav = useNavigate(); const { session } = useSession();
  const [period, setPeriod] = useState<Period>('30d'); const [warehouseId, setWarehouseId] = useState(''); const [activeArea, setActiveArea] = useState('overview');
  const dates = useMemo(() => rangeFor(period), [period]);
  const canSales = can('sales.view'); const canCosts = can('costs.view'); const canInventory = can('inventory.view'); const canItems = can('items.view') || canInventory;
  const canPurchases = can('purchases.view'); const canTreasury = can('treasury.view'); const canParties = can('parties.view'); const canEmployees = can('employees.view');
  const permissionsKey = session.user.permissions.join(','); const warehouseScopeKey = (session.user.warehouse_ids ?? []).join(',');
  const warehouses = useLiveQuery(async () => {
    if (!canInventory) return [];
    const allowed = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
    return (await db.warehouses.toArray()).filter((w) => w.active !== false && (!allowed || allowed.has(w.id))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  }, [canInventory, warehouseScopeKey]);
  const selectedWarehouse = warehouseId && (warehouses ?? []).some((w) => w.id === warehouseId) ? warehouseId : '';

  useEffect(() => { const slot = document.getElementById('nav-title-slot'); if (slot) slot.textContent = 'تحليل المحل'; setDocTitle('تحليل المحل'); }, []);

  const data = useLiveQuery(async () => {
    const types = [...(canSales ? ['sale_invoice', 'sale_return'] : []), ...(canPurchases ? ['purchase_invoice', 'purchase_return'] : []), ...(canTreasury ? ['expense', 'income', 'payroll'] : [])];
    const docsAll = types.length ? (await Promise.all(types.map((type) => db.documents.where('doc_type').equals(type).toArray()))).flat() : [];
    const docs = docsAll.filter((d) => (posted(d) || d.status === 'cancelled') && (!selectedWarehouse || !['sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return'].includes(d.doc_type) || d.warehouse_id === selectedWarehouse));
    const periodDocs = docs.filter((d) => d.date >= dates.prevFrom && d.date <= dates.to);
    const current = periodDocs.filter((d) => posted(d) && d.date >= dates.from && d.date <= dates.to);
    const previous = periodDocs.filter((d) => posted(d) && d.date >= dates.prevFrom && d.date <= dates.prevTo);
    const currentSales = current.filter((d) => ['sale_invoice', 'sale_return'].includes(d.doc_type)); const previousSales = previous.filter((d) => ['sale_invoice', 'sale_return'].includes(d.doc_type));
    const saleInvoices = current.filter((d) => d.doc_type === 'sale_invoice'); const priorInvoices = previous.filter((d) => d.doc_type === 'sale_invoice');
    const currentPurchases = current.filter((d) => ['purchase_invoice', 'purchase_return'].includes(d.doc_type)); const previousPurchases = previous.filter((d) => ['purchase_invoice', 'purchase_return'].includes(d.doc_type));
    const customerDocsAll = canParties && canSales ? (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter(posted) : [];
    const customerDocs = customerDocsAll.filter((d) => !selectedWarehouse || d.warehouse_id === selectedWarehouse);
    const lineDocs = [...new Map([...periodDocs.filter((d) => posted(d) && ['sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return'].includes(d.doc_type)), ...customerDocs.filter((d) => d.date >= since(dates.to, 90))].map((d) => [d.id, d])).values()];
    const lines = lineDocs.length ? await db.document_lines.where('document_id').anyOf(lineDocs.map((d) => d.id)).toArray() : [];
    const docsById = new Map(lineDocs.map((d) => [d.id, d]));
    const itemIds = [...new Set(lines.map((l) => l.item_id))]; const itemRows = canItems && itemIds.length ? await db.items.bulkGet(itemIds) : [];
    const items = new Map((itemRows.filter(Boolean) as any[]).map((item) => [item.id, item]));
    const linesByDoc = new Map<string, any[]>(); for (const line of lines) (linesByDoc.get(line.document_id) ?? linesByDoc.set(line.document_id, []).get(line.document_id)!).push(line);

    const salesNet = signedTotal(currentSales, ['sale_invoice', 'sale_return']); const priorSalesNet = signedTotal(previousSales, ['sale_invoice', 'sale_return']);
    const grossSales = currentSales.filter((d) => d.doc_type === 'sale_invoice').reduce((s, d) => s + (d.gross ?? d.total ?? 0), 0);
    const discounts = currentSales.filter((d) => d.doc_type === 'sale_invoice').reduce((s, d) => s + (d.discount ?? 0), 0);
    const returnValue = currentSales.filter((d) => d.doc_type === 'sale_return').reduce((s, d) => s + (d.total ?? 0), 0);
    const currentCostKnown = canCosts && currentSales.length > 0 && currentSales.every((d) => d.cost != null); const priorCostKnown = canCosts && previousSales.length > 0 && previousSales.every((d) => d.cost != null);
    const grossProfit = currentSales.reduce((s, d) => s + (d.doc_type === 'sale_invoice' ? 1 : -1) * ((d.total ?? 0) - (d.tax ?? 0) - (d.cost ?? 0)), 0);
    const priorGrossProfit = previousSales.reduce((s, d) => s + (d.doc_type === 'sale_invoice' ? 1 : -1) * ((d.total ?? 0) - (d.tax ?? 0) - (d.cost ?? 0)), 0);
    const expenses = current.filter((d) => d.doc_type === 'expense' || d.doc_type === 'payroll').reduce((s, d) => s + (d.amount ?? d.total ?? 0), 0);
    const priorExpenses = previous.filter((d) => d.doc_type === 'expense' || d.doc_type === 'payroll').reduce((s, d) => s + (d.amount ?? d.total ?? 0), 0);
    const otherIncome = current.filter((d) => d.doc_type === 'income').reduce((s, d) => s + (d.amount ?? d.total ?? 0), 0);
    const estimatedNetProfit = canTreasury ? grossProfit - expenses + otherIncome : null;
    const priorEstimatedProfit = priorGrossProfit - priorExpenses + previous.filter((d) => d.doc_type === 'income').reduce((s, d) => s + (d.amount ?? d.total ?? 0), 0);

    const salesByItem = new Map<string, any>(); const purchaseByItemSupplier = new Map<string, any>(); const purchasesBySupplier = new Map<string, any>();
    const productInvoiceItems = new Map<string, Set<string>>(); const weekdaySales = new Map<number, number>();
    for (const d of currentSales) {
      const sign = d.doc_type === 'sale_invoice' ? 1 : -1; const day = new Date(`${d.date}T12:00:00`).getDay(); weekdaySales.set(day, (weekdaySales.get(day) ?? 0) + sign * ((d.total ?? 0) - (d.tax ?? 0)));
      if (d.doc_type === 'sale_invoice' && d.party_id) {
        const set = productInvoiceItems.get(d.id) ?? new Set<string>(); for (const l of linesByDoc.get(d.id) ?? []) set.add(l.item_id); productInvoiceItems.set(d.id, set);
      }
      for (const l of linesByDoc.get(d.id) ?? []) {
        const row = salesByItem.get(l.item_id) ?? { qty: 0, sales: 0, cost: 0, profit: 0, costKnown: true, returns: 0, discounts: 0, invoices: 0 };
        row.qty += sign * (l.base_qty ?? l.qty ?? 0); row.sales += sign * ((l.total ?? 0) - (l.tax ?? 0)); row.cost += sign * (l.cost ?? 0); row.profit += sign * ((l.total ?? 0) - (l.tax ?? 0) - (l.cost ?? 0)); row.costKnown &&= l.cost != null;
        if (sign < 0) row.returns += l.base_qty ?? l.qty ?? 0; row.discounts += sign * (l.discount ?? 0); row.invoices += sign;
        salesByItem.set(l.item_id, row);
      }
    }
    const purchasedSupplierItemCounts = new Map<string, Set<string>>();
    for (const d of currentPurchases) {
      const sign = d.doc_type === 'purchase_invoice' ? 1 : -1;
      const supplier = purchasesBySupplier.get(d.party_id ?? 'unknown') ?? { value: 0, invoices: 0, itemCount: new Set<string>() };
      supplier.value += sign * (d.total ?? 0); supplier.invoices += sign; purchasesBySupplier.set(d.party_id ?? 'unknown', supplier);
      for (const l of linesByDoc.get(d.id) ?? []) {
        const key = `${d.party_id ?? 'unknown'}:${l.item_id}`; const row = purchaseByItemSupplier.get(key) ?? { supplierId: d.party_id, itemId: l.item_id, cost: 0, qty: 0, prices: [], known: true };
        const qty = l.base_qty ?? l.qty ?? 0; row.cost += sign * (l.cost ?? ((l.total ?? 0) - (l.tax ?? 0))); row.qty += sign * qty; row.known &&= l.cost != null; if (qty) row.prices.push((l.cost ?? ((l.total ?? 0) - (l.tax ?? 0))) * 1000 / qty);
        purchaseByItemSupplier.set(key, row); supplier.itemCount.add(l.item_id); purchasedSupplierItemCounts.set(d.party_id ?? 'unknown', (purchasedSupplierItemCounts.get(d.party_id ?? 'unknown') ?? new Set()).add(l.item_id));
      }
      purchasesBySupplier.set(d.party_id ?? 'unknown', supplier);
    }

    const supplierParties = canParties && canPurchases ? (await db.parties.where('kind').equals('supplier').toArray()) : [];
    const customerParties = canParties ? (await db.parties.where('kind').equals('customer').toArray()) : [];
    const partyNames = new Map([...supplierParties, ...customerParties].map((p: any) => [p.id, p.name]));
    const allTimeCustomerRollup = new Map<string, { total: number; count: number; lastDate: string; itemCounts: Map<string, number>; itemOrders: Map<string, number> }>();
    for (const d of customerDocs) {
      if (!d.party_id) continue; const s = allTimeCustomerRollup.get(d.party_id) ?? { total: 0, count: 0, lastDate: '', itemCounts: new Map<string, number>(), itemOrders: new Map<string, number>() };
      s.total += (d.total ?? 0) - (d.tax ?? 0); s.count++; if (d.date > s.lastDate) s.lastDate = d.date;
      if (d.date >= since(dates.to, 90)) {
        const orderItems = new Set<string>();
        for (const l of linesByDoc.get(d.id) ?? []) { s.itemCounts.set(l.item_id, (s.itemCounts.get(l.item_id) ?? 0) + (l.base_qty ?? l.qty ?? 0)); orderItems.add(l.item_id); }
        for (const itemId of orderItems) s.itemOrders.set(itemId, (s.itemOrders.get(itemId) ?? 0) + 1);
      }
      allTimeCustomerRollup.set(d.party_id, s);
    }
    const currentCustomerTotals = new Map<string, { total: number; count: number }>();
    for (const d of saleInvoices) if (d.party_id) { const v = currentCustomerTotals.get(d.party_id) ?? { total: 0, count: 0 }; v.total += (d.total ?? 0) - (d.tax ?? 0); v.count++; currentCustomerTotals.set(d.party_id, v); }
    const topCustomers = [...currentCustomerTotals].map(([id, x]) => ({ id, name: partyNames.get(id) ?? 'عميل غير معروف', ...x, avg: x.total / x.count, balance: customerParties.find((p: any) => p.id === id)?.balance ?? 0 })).sort((a, b) => b.total - a.total).slice(0, 10);
    const inactiveCustomers = canSales ? customerParties.map((p: any) => ({ id: p.id, name: p.name, balance: p.balance ?? 0, lastDate: allTimeCustomerRollup.get(p.id)?.lastDate ?? '' })).filter((p) => !p.lastDate || p.lastDate < since(dates.to, 60)).sort((a, b) => b.balance - a.balance).slice(0, 12) : [];
    const regularCustomerProducts = [...allTimeCustomerRollup].flatMap(([customerId, rollup]) => [...rollup.itemOrders].map(([itemId, orders]) => ({ customerId, itemId, orders, qty: rollup.itemCounts.get(itemId) ?? 0 }))).filter((r) => r.orders > 1).sort((a, b) => b.orders - a.orders).slice(0, 12).map((row) => ({ ...row, customerName: partyNames.get(row.customerId) ?? 'عميل', itemName: items.get(row.itemId)?.name ?? 'صنف' }));
    const coBuy = new Map<string, number>(); for (const set of productInvoiceItems.values()) { const ids = [...set].sort(); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = `${ids[i]}|${ids[j]}`; coBuy.set(k, (coBuy.get(k) ?? 0) + 1); } }
    const coBuys = [...coBuy].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => { const [a, b] = key.split('|'); return { a: items.get(a)?.name ?? 'صنف', b: items.get(b)?.name ?? 'صنف', count }; });

    let stockRows: any[] = []; let itemsAll: any[] = []; let negativeStock: any[] = []; let lowStock: any[] = []; let deadStock: any[] = []; let overstock: any[] = [];
    if (canInventory) {
      const allowedWarehouses = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
      stockRows = (await db.stock_balances.toArray()).filter((r) => (!allowedWarehouses || allowedWarehouses.has(r.warehouse_id)) && (!selectedWarehouse || r.warehouse_id === selectedWarehouse));
      itemsAll = (await db.items.toArray()).filter((it) => it.active !== false && !it.is_service);
      const qty = new Map<string, number>(); const value = new Map<string, number>();
      for (const r of stockRows) { qty.set(r.item_id, (qty.get(r.item_id) ?? 0) + (r.qty ?? 0)); value.set(r.item_id, (value.get(r.item_id) ?? 0) + (r.value ?? 0)); }
      negativeStock = itemsAll.filter((it) => (qty.get(it.id) ?? 0) < 0).map((it) => ({ name: it.name, qty: qty.get(it.id) ?? 0 }));
      lowStock = itemsAll.filter((it) => it.reorder_level > 0 && (qty.get(it.id) ?? 0) <= it.reorder_level).map((it) => ({ id: it.id, name: it.name, qty: qty.get(it.id) ?? 0, min: it.reorder_level })).sort((a, b) => a.qty - b.qty);
      const sold90 = new Set<string>();
      for (const doc of lineDocs.filter((d) => ['sale_invoice', 'sale_return'].includes(d.doc_type) && d.date >= since(dates.to, 90))) {
        for (const line of linesByDoc.get(doc.id) ?? []) sold90.add(line.item_id);
      }
      deadStock = itemsAll.filter((it) => (qty.get(it.id) ?? 0) > 0 && !sold90.has(it.id)).map((it) => ({ id: it.id, name: it.name, qty: qty.get(it.id) ?? 0, value: value.get(it.id) ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 20);
      const sold90Qty = new Map<string, number>(); for (const doc of lineDocs.filter((d) => ['sale_invoice', 'sale_return'].includes(d.doc_type) && d.date >= since(dates.to, 90))) for (const l of linesByDoc.get(doc.id) ?? []) sold90Qty.set(l.item_id, (sold90Qty.get(l.item_id) ?? 0) + (doc.doc_type === 'sale_invoice' ? 1 : -1) * (l.base_qty ?? l.qty ?? 0));
      overstock = itemsAll.map((it) => { const soldQty = sold90Qty.get(it.id) ?? 0; return { id: it.id, name: it.name, qty: qty.get(it.id) ?? 0, value: value.get(it.id) ?? 0, cover: soldQty > 0 ? (qty.get(it.id) ?? 0) / (soldQty / 90) : null }; }).filter((it) => it.cover != null && it.cover >= 60).sort((a, b) => b.value - a.value).slice(0, 20);
    }
    const priorSalesByItem = new Map<string, number>();
    for (const doc of previousSales) for (const line of linesByDoc.get(doc.id) ?? []) priorSalesByItem.set(line.item_id, (priorSalesByItem.get(line.item_id) ?? 0) + (doc.doc_type === 'sale_invoice' ? 1 : -1) * ((line.total ?? 0) - (line.tax ?? 0)));
    const itemSales = [...salesByItem].map(([id, stats]) => ({ id, name: items.get(id)?.name ?? 'صنف غير معروف', ...stats, stock: stockRows.filter((r) => r.item_id === id).reduce((s, r) => s + (r.qty ?? 0), 0), stockValue: stockRows.filter((r) => r.item_id === id).reduce((s, r) => s + (r.value ?? 0), 0) }));
    const profitableItems = itemSales.filter((r) => r.costKnown).sort((a, b) => b.profit - a.profit).slice(0, 20);
    const weakMarginItems = itemSales.filter((r) => r.costKnown && r.sales > 0).map((r) => ({ ...r, margin: r.profit / r.sales * 100 })).filter((r) => r.margin < 10 || r.profit < 0).sort((a, b) => a.margin - b.margin).slice(0, 12);
    const risingItems = [...new Set([...salesByItem.keys(), ...priorSalesByItem.keys()])].map((id) => { const current = salesByItem.get(id); const sales = current?.sales ?? 0; const prior = priorSalesByItem.get(id) ?? 0; return { id, name: items.get(id)?.name ?? 'صنف غير معروف', sales, prior, qty: current?.qty ?? 0, delta: pctChange(sales, prior) }; }).filter((r) => r.delta != null).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 8);
    const fallingItems = [...risingItems].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 8);

    const currentSupplierTotals = new Map([...purchasesBySupplier].map(([id, x]) => [id, x.value]));
    const topSuppliers = [...currentSupplierTotals].map(([id, value]) => ({ id, name: partyNames.get(id) ?? 'مورد غير معروف', value, invoices: purchasesBySupplier.get(id)?.invoices ?? 0, itemCount: purchasesBySupplier.get(id)?.itemCount?.size ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 10);
    const purchaseItemStats = new Map<string, { qty: number; value: number }>(); for (const d of currentPurchases) for (const l of linesByDoc.get(d.id) ?? []) { const x = purchaseItemStats.get(l.item_id) ?? { qty: 0, value: 0 }; const sign = d.doc_type === 'purchase_invoice' ? 1 : -1; x.qty += sign * (l.base_qty ?? l.qty ?? 0); x.value += sign * (l.cost ?? ((l.total ?? 0) - (l.tax ?? 0))); purchaseItemStats.set(l.item_id, x); }
    const purchaseValue = signedTotal(currentPurchases, ['purchase_invoice', 'purchase_return']); const priorPurchaseValue = signedTotal(previousPurchases, ['purchase_invoice', 'purchase_return']);
    const spendByAccount = new Map<string, number>(); for (const d of current.filter((x) => x.doc_type === 'expense' || x.doc_type === 'payroll')) spendByAccount.set(d.account_id ?? (d.doc_type === 'payroll' ? 'payroll' : 'uncategorized'), (spendByAccount.get(d.account_id ?? (d.doc_type === 'payroll' ? 'payroll' : 'uncategorized')) ?? 0) + (d.amount ?? d.total ?? 0));
    const accounts = canTreasury ? await db.accounts.toArray() : []; const accountNames = new Map(accounts.map((a: any) => [a.id, a.name]));
    const expensesByCategory = [...spendByAccount].map(([id, amount]) => ({ id, name: id === 'payroll' ? 'رواتب' : id === 'uncategorized' ? 'مصروفات غير مصنفة' : accountNames.get(id) ?? 'بند غير معروف', amount })).sort((a, b) => b.amount - a.amount);

    const reps = canEmployees && canSales ? await db.sales_reps.toArray() : []; const repsById = new Map(reps.map((r: any) => [r.id, r.name]));
    const repStats = new Map<string, { sales: number; count: number; priorSales: number; priorCount: number; returns: number; returnCount: number; discount: number; cancelled: number }>();
    for (const d of [...currentSales, ...previousSales, ...docs.filter((d) => d.status === 'cancelled' && ['sale_invoice', 'sale_return'].includes(d.doc_type) && d.date >= dates.from && d.date <= dates.to)]) {
      if (!d.sales_rep_id) continue; const row = repStats.get(d.sales_rep_id) ?? { sales: 0, count: 0, priorSales: 0, priorCount: 0, returns: 0, returnCount: 0, discount: 0, cancelled: 0 };
      if (posted(d)) { const sign = d.doc_type === 'sale_invoice' ? 1 : -1; const isCurrent = d.date >= dates.from && d.date <= dates.to; if (isCurrent) { row.sales += sign * ((d.total ?? 0) - (d.tax ?? 0)); row.count += sign; if (sign < 0) { row.returns += d.total ?? 0; row.returnCount++; } row.discount += d.discount ?? 0; } else { row.priorSales += sign * ((d.total ?? 0) - (d.tax ?? 0)); row.priorCount += sign; } } else row.cancelled++;
      repStats.set(d.sales_rep_id, row);
    }
    const repRows = [...repStats].map(([id, x]) => ({ id, name: repsById.get(id) ?? 'مندوب غير معروف', ...x, average: x.count ? x.sales / x.count : 0 })).sort((a, b) => b.sales - a.sales);
    const canceledSales = canSales ? docs.filter((d) => d.status === 'cancelled' && ['sale_invoice', 'sale_return'].includes(d.doc_type) && d.date >= dates.from && d.date <= dates.to) : [];
    const overdueDocs = canSales ? (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter((d) => posted(d) && !d.closed && d.due_date && d.due_date < dates.to && (d.total ?? 0) > (d.paid ?? 0)) : [];
    const overdueTotal = overdueDocs.reduce((s, d) => s + Math.max(0, (d.total ?? 0) - (d.paid ?? 0)), 0);
    const supplierCount = new Set(currentPurchases.filter((d) => d.doc_type === 'purchase_invoice').map((d) => d.party_id).filter(Boolean)).size;
    const purchaseShares = topSuppliers.map((s) => ({ ...s, share: purchaseValue > 0 ? s.value * 100 / purchaseValue : 0 }));
    const supplierPriceByPeriod = new Map<string, any>();
    for (const [purchaseDocs, slot] of [[currentPurchases.filter((d) => d.doc_type === 'purchase_invoice'), 'current'], [previousPurchases.filter((d) => d.doc_type === 'purchase_invoice'), 'previous']] as const) {
      for (const doc of purchaseDocs) for (const line of linesByDoc.get(doc.id) ?? []) {
        const qty = line.base_qty ?? line.qty ?? 0; if (!doc.party_id || !qty || line.cost == null) continue;
        const key = `${doc.party_id}:${line.item_id}`; const row = supplierPriceByPeriod.get(key) ?? { supplierId: doc.party_id, itemId: line.item_id, currentCost: 0, currentQty: 0, previousCost: 0, previousQty: 0 };
        row[slot === 'current' ? 'currentCost' : 'previousCost'] += line.cost; row[slot === 'current' ? 'currentQty' : 'previousQty'] += qty; supplierPriceByPeriod.set(key, row);
      }
    }
    const priceChanges = [...supplierPriceByPeriod.values()].filter((r) => r.currentQty > 0 && r.previousQty > 0).map((r) => ({ ...r, name: items.get(r.itemId)?.name ?? 'صنف', supplierName: partyNames.get(r.supplierId) ?? 'مورد', currentUnitCost: r.currentCost * 1000 / r.currentQty, previousUnitCost: r.previousCost * 1000 / r.previousQty })).map((r) => ({ ...r, change: r.previousUnitCost ? (r.currentUnitCost - r.previousUnitCost) * 100 / r.previousUnitCost : null })).filter((r) => r.change != null && r.change > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 10);
    const comparisonSupplierRows = new Map<string, { itemId: string; suppliers: Map<string, { cost: number; qty: number }> }>();
    for (const row of purchaseByItemSupplier.values()) { if (!row.known || row.qty <= 0 || !row.supplierId) continue; const group = comparisonSupplierRows.get(row.itemId) ?? { itemId: row.itemId, suppliers: new Map() }; group.suppliers.set(row.supplierId, { cost: row.cost, qty: row.qty }); comparisonSupplierRows.set(row.itemId, group); }
    const supplierComparisons = [...comparisonSupplierRows.values()].filter((r) => r.suppliers.size > 1).map((r) => ({ item: items.get(r.itemId)?.name ?? 'صنف', options: [...r.suppliers].map(([id, x]) => ({ supplier: partyNames.get(id) ?? 'مورد', costPerUnit: x.cost * 1000 / x.qty })).sort((a, b) => a.costPerUnit - b.costPerUnit) })).slice(0, 12);
    const supplierWins = new Map<string, number>(); for (const row of supplierComparisons) { const winner = row.options[0]?.supplier; if (winner) supplierWins.set(winner, (supplierWins.get(winner) ?? 0) + 1); }
    const bestSupplier = [...supplierWins].sort((a, b) => b[1] - a[1])[0];
    const seasonByMonth = new Map<number, number>(); for (const d of docsAll.filter((x) => posted(x) && ['sale_invoice', 'sale_return'].includes(x.doc_type))) { const month = Number(d.date.slice(5, 7)); const sign = d.doc_type === 'sale_invoice' ? 1 : -1; seasonByMonth.set(month, (seasonByMonth.get(month) ?? 0) + sign * ((d.total ?? 0) - (d.tax ?? 0))); }
    const bestSeason = [...seasonByMonth].sort((a, b) => b[1] - a[1])[0];
    let attendanceStats: { late: number; records: number; employee: string; lateRate: number }[] = [];
    if (canEmployees) {
      const [attendanceRows, employees] = await Promise.all([db.attendance.where('date').between(dates.from, dates.to, true, true).toArray(), db.employees.toArray()]);
      const employeeName = new Map(employees.map((e: any) => [e.id, e.name])); const byEmployee = new Map<string, { late: number; records: number }>();
      for (const row of attendanceRows) { const x = byEmployee.get(row.employee_id) ?? { late: 0, records: 0 }; x.records++; if (row.status === 'late') x.late++; byEmployee.set(row.employee_id, x); }
      attendanceStats = [...byEmployee].map(([id, x]) => ({ ...x, employee: employeeName.get(id) ?? 'موظف غير معروف', lateRate: x.records ? x.late * 100 / x.records : 0 })).sort((a, b) => a.lateRate - b.lateRate);
    }
    const weekdayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const peakDay = [...weekdaySales].sort((a, b) => b[1] - a[1])[0]; const lowDay = [...weekdaySales].sort((a, b) => a[1] - b[1])[0];
    const currentAverage = saleInvoices.length ? salesNet / saleInvoices.length : 0; const priorAverage = priorInvoices.length ? priorSalesNet / priorInvoices.length : 0;
    const paymentModes = new Map<string, number>(); const cbs = canTreasury ? await db.cashboxes.toArray() : []; const cbNames = new Map(cbs.map((c: any) => [c.id, c.kind === 'cash' ? 'نقدي' : c.name]));
    if (canSales) for (const d of saleInvoices) for (const p of d.data?.payments ?? []) paymentModes.set(cbNames.get(p.cashbox_id) ?? 'طريقة غير معروفة', (paymentModes.get(cbNames.get(p.cashbox_id) ?? 'طريقة غير معروفة') ?? 0) + (p.amount ?? 0));
    return {
      current, previous, salesNet, priorSalesNet, saleInvoices: saleInvoices.length, priorInvoices: priorInvoices.length, currentAverage, priorAverage, grossSales, discounts, returnValue,
      currentCostKnown, priorCostKnown, grossProfit, priorGrossProfit, expenses, priorExpenses, otherIncome, estimatedNetProfit, priorEstimatedProfit, itemSales, profitableItems, weakMarginItems, risingItems, fallingItems,
      deadStock, overstock, lowStock, negativeStock, stockRows, itemsAll, topCustomers, inactiveCustomers, regularCustomerProducts, overdueTotal, overdueCount: overdueDocs.length,
      coBuys, weekdayNames, peakDay: peakDay ? { name: weekdayNames[peakDay[0]], value: peakDay[1] } : null, lowDay: lowDay ? { name: weekdayNames[lowDay[0]], value: lowDay[1] } : null,
      purchases: purchaseValue, priorPurchases: priorPurchaseValue, topSuppliers, supplierCount, purchaseShares, priceChanges, supplierComparisons, purchaseItemStats,
      purchaseItems: [...purchaseItemStats].map(([id, x]) => ({ id, name: items.get(id)?.name ?? 'صنف', ...x })).sort((a, b) => b.value - a.value), expensesByCategory,
      repRows, canceledSales: canceledSales.length, paymentModes, salesCount: currentSales.length, purchaseDocsCount: currentPurchases.length, bestSupplier, bestSeason: bestSeason ? { month: bestSeason[0], value: bestSeason[1] } : null, attendanceStats,
      currentProfitVsPrior: currentCostKnown && priorCostKnown && canTreasury ? pctChange(estimatedNetProfit ?? 0, priorEstimatedProfit) : null, grossProfitChange: currentCostKnown && priorCostKnown ? pctChange(grossProfit, priorGrossProfit) : null, salesChange: pctChange(salesNet, priorSalesNet), avgChange: pctChange(currentAverage, priorAverage), expenseChange: pctChange(expenses, priorExpenses), purchaseChange: pctChange(purchaseValue, priorPurchaseValue),
    };
  }, [dates.from, dates.to, dates.prevFrom, dates.prevTo, selectedWarehouse, permissionsKey, warehouseScopeKey, session.user.id]);

  const sections = useMemo((): AnalysisSection[] => {
    if (!data) return [];
    const entries = (items: Entry[]) => items.filter((item) => !item.perm || can(item.perm));
    const pct = (x: number | null | undefined) => x == null ? 'لا توجد مقارنة كافية' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`;
    const salesDirection = data.salesChange == null ? 'لا توجد فترة سابقة للمقارنة' : `المبيعات ${data.salesChange >= 0 ? 'زادت' : 'انخفضت'} ${Math.abs(data.salesChange).toFixed(1)}% مقارنة بالفترة السابقة.`;
    const salesForItem = (r: any) => `${formatMoney(r.sales)} · ${formatQty(r.qty)} وحدة`;
    const itemsTop = (rows: any[], value: (x: any) => string, note: (x: any) => string, perm = 'items.view') => rows.slice(0, 20).map((r) => ({ name: r.name, value: value(r), note: note(r), to: `/items/${r.id}`, perm }));
    const salesItems = data.itemSales.filter((r: any) => r.qty > 0);
    const profitDelta = data.grossProfitChange;
    const areas: AnalysisSection[] = [
      { id: 'overview', label: 'الصورة العامة', icon: Store, headline: 'أنت واقف فين دلوقتي؟', summary: `${salesDirection} ${data.estimatedNetProfit == null ? 'يلزم صلاحية عرض المصروفات لحساب النتيجة بعد المصروفات.' : `الربح بعد المصروفات المسجلة ${formatMoney(data.estimatedNetProfit)}، والمقارنة السابقة ${pct(data.currentProfitVsPrior)}.`}`, entries: entries([
        { name: 'صافي المبيعات', value: formatMoney(data.salesNet), note: `${data.saleInvoices} فاتورة بيع · ${formatMoney(data.priorSalesNet)} في الفترة السابقة`, tone: data.salesChange != null && data.salesChange < 0 ? 'watch' : 'good', to: '/docs/list/sales', perm: 'sales.view' },
        { name: 'ربح البضاعة الفعلي', value: data.currentCostKnown ? formatMoney(data.grossProfit) : 'تكلفة ناقصة', note: data.currentCostKnown ? `تكلفة البضاعة المسجلة · التغير ${pct(profitDelta)}` : 'بعض فواتير البيع لا تحتوي على تكلفة مرحّلة', tone: !data.currentCostKnown ? 'watch' : profitDelta != null && profitDelta < 0 ? 'watch' : 'good', to: '/reports/analysis', perm: 'reports.profit' },
        { name: 'بعد المصروفات المسجلة', value: data.currentCostKnown && data.estimatedNetProfit != null ? formatMoney(data.estimatedNetProfit) : 'غير مكتمل', note: 'ربح البضاعة ناقص المصروفات والرواتب المسجلة، زائد الإيرادات الأخرى المسجلة. لا يشمل قيودًا غير متزامنة أو غير ممثلة هنا.', tone: data.estimatedNetProfit != null && data.estimatedNetProfit < 0 ? 'watch' : 'neutral', perm: 'treasury.view' },
        { name: 'أكبر خطر حالي', value: data.overdueTotal > 0 ? formatMoney(data.overdueTotal) : data.negativeStock.length ? `${data.negativeStock.length} أرصدة سالبة` : data.lowStock.length ? `${data.lowStock.length} أصناف عند الطلب` : data.deadStock.length ? formatMoney(data.deadStock.reduce((s: number, x: any) => s + x.value, 0)) : 'لا يظهر خطر واضح', note: data.overdueTotal > 0 ? `${data.overdueCount} فاتورة متأخرة تحتاج تحصيل` : 'اختيار الخطر من الأرصدة وحالة الطلب في البيانات المتاحة', tone: data.overdueTotal > 0 || data.negativeStock.length || data.lowStock.length ? 'watch' : 'neutral', to: data.overdueTotal > 0 ? '/receivables' : '/reports/reorder', perm: data.overdueTotal > 0 ? 'sales.view' : 'inventory.view' },
        { name: 'أكبر فرصة ربح', value: data.profitableItems[0]?.name ?? 'بيانات غير كافية', note: data.profitableItems[0] ? `أعلى مساهمة ربح مسجلة: ${formatMoney(data.profitableItems[0].profit)}. حافظ على توفره.` : 'يلزم تكلفة فعلية مسجلة على فواتير البيع.', tone: 'good', to: '/reports/analysis', perm: 'reports.profit' },
      ]) },
      { id: 'profit', label: 'الأرباح', icon: BadgeDollarSign, headline: 'الربح الفعلي وأسباب تغيّره', summary: data.currentCostKnown ? `ربح البضاعة ${formatMoney(data.grossProfit)} بعد استبعاد الضريبة والتكلفة الفعلية. ${profitDelta == null ? 'لا تتوفر مقارنة ربح سابقة كافية.' : `التغير عن الفترة السابقة ${pct(profitDelta)}.`}` : 'لا أعرض ربحًا نهائيًا لأن تكلفة بعض الفواتير المرحلة غير متاحة.', permission: canCosts || can('reports.profit') ? undefined : 'costs.view', entries: entries([
        { name: 'ربح البضاعة بعد المرتجعات', value: data.currentCostKnown ? formatMoney(data.grossProfit) : 'غير مكتمل', note: 'صافي البيع بدون الضريبة ناقص تكلفة البضاعة الفعلية المسجلة، مع عكس تكلفة المرتجعات.', tone: data.currentCostKnown && data.grossProfit < 0 ? 'watch' : 'neutral', perm: 'costs.view' },
        { name: 'سبب التغير في الربح', value: profitDelta == null ? 'لا توجد مقارنة' : `${profitDelta > 0 ? 'زيادة' : 'انخفاض'} ${Math.abs(profitDelta).toFixed(1)}%`, note: `الربح الحالي ${formatMoney(data.grossProfit)} · السابق ${formatMoney(data.priorGrossProfit)}. راجع تغيّر البيع والتكلفة والخصومات والمرتجعات أدناه.`, tone: profitDelta != null && profitDelta < 0 ? 'watch' : 'neutral', perm: 'costs.view' },
        { name: 'الخصومات', value: formatMoney(data.discounts), note: `تمثل ${data.grossSales ? (data.discounts * 100 / data.grossSales).toFixed(1) : '0.0'}% من إجمالي قيمة فواتير البيع قبل الخصم.`, tone: data.grossSales && data.discounts / data.grossSales > 0.1 ? 'watch' : 'neutral', perm: 'sales.view' },
        { name: 'أثر المرتجعات', value: formatMoney(data.returnValue), note: `مقابل إجمالي بيع ${formatMoney(data.grossSales)}. راجع الأسباب والأصناف المرتجعة قبل إعادة الشراء.`, tone: data.grossSales && data.returnValue / data.grossSales > 0.05 ? 'watch' : 'neutral', perm: 'sales.view' },
        { name: 'أولوية لزيادة صافي الربح', value: data.weakMarginItems[0]?.name ?? data.lowStock[0]?.name ?? data.deadStock[0]?.name ?? 'راجع تغير المبيعات والربح', note: data.weakMarginItems[0] ? `هامشه المسجل ${data.weakMarginItems[0].margin.toFixed(1)}%؛ راجع سعره وتكلفته والخصم قبل زيادة بيعه.` : data.lowStock[0] ? `صنف عليه طلب ورصيده ${formatQty(data.lowStock[0].qty)}؛ تأمين التوفر قد يحافظ على المبيعات.` : data.deadStock[0] ? 'اختبر تصريف المخزون الراكد بعرض مدروس بعد مراجعة هامش الربح.' : 'قارن بين أعلى الأصناف مبيعًا وأعلى الأصناف ربحًا قبل توجيه العروض.', tone: 'watch', perm: 'reports.profit' },
        ...itemsTop(data.profitableItems.slice(0, 20), (r) => formatMoney(r.profit), (r) => `هامش ${r.sales ? (r.profit / r.sales * 100).toFixed(1) : '0.0'}% · بيع ${formatMoney(r.sales)}`, 'reports.profit'),
        ...itemsTop(data.weakMarginItems, (r) => `${r.margin.toFixed(1)}% هامش`, (r) => `${formatMoney(r.profit)} ربح · ${salesForItem(r)}`, 'reports.profit'),
      ]) },
      { id: 'items', label: 'الأصناف', icon: PackageSearch, headline: 'الأصناف التي تكسب وتتحرك وتتوقف', summary: `تظهر هنا مساهمة الربح والاتجاه والركود بحسب الفواتير المرحلة للفترة المختارة.`, permission: canItems ? undefined : 'items.view', entries: entries([
        ...itemsTop(data.profitableItems, (r) => formatMoney(r.profit), (r) => `${salesForItem(r)} · هامش ${r.sales ? (r.profit / r.sales * 100).toFixed(1) : '0.0'}%`, 'reports.profit'),
        ...itemsTop(data.deadStock, (r) => formatMoney(r.value), (r) => `${formatQty(r.qty)} بالمخزون · بلا بيع خلال 90 يوم`, 'costs.view'),
        ...itemsTop(data.risingItems, (r) => `${r.delta != null && r.delta > 0 ? '+' : ''}${(r.delta ?? 0).toFixed(1)}%`, (r) => `${formatMoney(r.sales)} الآن مقابل ${formatMoney(r.prior)} سابقًا`, 'items.view'),
        ...itemsTop(data.fallingItems.filter((r: any) => (r.delta ?? 0) < 0), (r) => `${(r.delta ?? 0).toFixed(1)}%`, (r) => `${formatMoney(r.sales)} الآن مقابل ${formatMoney(r.prior)} سابقًا`, 'items.view'),
        ...itemsTop(data.lowStock, (r) => `${formatQty(r.qty)} / حد ${formatQty(r.min)}`, () => 'راجع الكمية قبل إنشاء طلب شراء', 'inventory.view'),
        ...itemsTop(data.weakMarginItems, (r) => `${r.margin.toFixed(1)}% هامش`, (r) => `${formatMoney(r.profit)} ربح على ${formatMoney(r.sales)} بيع`, 'reports.profit'),
      ]) },
      { id: 'inventory', label: 'المخزون', icon: Boxes, headline: 'صحة المخزون ورأس المال المجمّد', summary: `قيمة المخزون تحسب من أرصدة التكلفة المزامنة للمخازن المسموح بها. الركود يعني عدم وجود بيع مسجل خلال آخر 90 يومًا.`, permission: canInventory ? undefined : 'inventory.view', entries: entries([
        { name: 'إجمالي قيمة المخزون', value: formatMoney(data.stockRows.reduce((s: number, r: any) => s + (r.value ?? 0), 0)), note: 'حسب قيمة التكلفة في أرصدة المخازن الحالية', perm: 'costs.view' },
        { name: 'قيمة البضاعة الراكدة', value: formatMoney(data.deadStock.reduce((s: number, r: any) => s + r.value, 0)), note: `${data.deadStock.length} أصناف لها رصيد ولم تبع خلال 90 يومًا`, tone: data.deadStock.length ? 'watch' : 'good', perm: 'costs.view' },
        { name: 'قريب من النفاد / حد الطلب', value: `${data.lowStock.length} صنف`, note: data.lowStock.slice(0, 5).map((r: any) => `${r.name}: ${formatQty(r.qty)} (الحد ${formatQty(r.min)})`).join(' · ') || 'لا توجد أصناف تحت حد الطلب المسجل', tone: data.lowStock.length ? 'watch' : 'good', to: '/reports/reorder', perm: 'inventory.view' },
        { name: 'غطاء مخزون يتجاوز 60 يومًا', value: `${data.overstock.length} صنف`, note: 'تقدير من رصيد اليوم ومعدل صافي البيع في 90 يومًا، ولا يعتبر حدًا محاسبيًا.', tone: data.overstock.length ? 'watch' : 'neutral', perm: 'inventory.view' },
        { name: 'أرصدة سالبة', value: `${data.negativeStock.length} صنف`, note: data.negativeStock.slice(0, 5).map((r: any) => `${r.name}: ${formatQty(r.qty)}`).join(' · ') || 'لا توجد أرصدة سالبة ظاهرة', tone: data.negativeStock.length ? 'watch' : 'good', to: '/reports/stock', perm: 'inventory.view' },
        { name: 'اختلافات حركة المخزون', value: 'لا يمكن التحقق منها محليًا', note: 'قاعدة الجهاز لا تحتوي على سجل حركات المخزون الكامل اللازم لمطابقة الرصيد مع الحركة.', tone: 'neutral', perm: 'inventory.view' },
      ]) },
      { id: 'sales', label: 'المبيعات', icon: ShoppingBasket, headline: 'إيقاع البيع والعملاء والمنتجات', summary: `${salesDirection} أفضل يوم ظاهر في الفواتير هو ${data.peakDay?.name ?? 'غير متاح'}؛ اليوم الأضعف ${data.lowDay?.name ?? 'غير متاح'}.`, permission: canSales ? undefined : 'sales.view', entries: entries([
        { name: 'متوسط الفاتورة', value: formatMoney(data.currentAverage), note: `التغير ${pct(data.avgChange)} عن الفترة السابقة`, tone: data.avgChange != null && data.avgChange < 0 ? 'watch' : 'neutral', to: '/docs/list/sales', perm: 'sales.view' },
        { name: 'أفضل يوم بيع', value: data.peakDay?.name ?? 'لا توجد بيانات', note: data.peakDay ? formatMoney(data.peakDay.value) : 'لا توجد فواتير مرحّلة', perm: 'sales.view' },
        { name: 'اليوم الأضعف', value: data.lowDay?.name ?? 'لا توجد بيانات', note: data.lowDay ? formatMoney(data.lowDay.value) : 'لا توجد فواتير مرحّلة', tone: 'watch', perm: 'sales.view' },
        { name: 'أفضل شهر في السجل', value: data.bestSeason ? new Intl.DateTimeFormat('ar-EG', { month: 'long' }).format(new Date(2020, data.bestSeason.month - 1, 1)) : 'لا توجد بيانات', note: data.bestSeason ? `${formatMoney(data.bestSeason.value)} صافي بيع متراكم في هذا الشهر عبر البيانات المسجلة.` : 'لا توجد فواتير مبيعات كافية.', perm: 'sales.view' },
        { name: 'أفضل ساعة بيع', value: 'غير متاح', note: 'الفاتورة تخزن التاريخ فقط ولا تسجل ساعة موثوقة.', perm: 'sales.view' },
        { name: 'الأصناف التي تباع معًا', value: data.coBuys[0] ? `${data.coBuys[0].a} + ${data.coBuys[0].b}` : 'بيانات غير كافية', note: data.coBuys[0] ? `ظهرا معًا في ${data.coBuys[0].count} فاتورة بيع خلال الفترة.` : 'يلزم ظهور أكثر من صنف في فواتير متعددة.', perm: 'sales.view' },
        { name: 'الفروع', value: 'غير متاح', note: 'النظام الحالي لا يسجل معرف فرع على الفواتير؛ لن أعتبر المخزن فرعًا.', perm: 'sales.view' },
        { name: 'تغير متوسط الفاتورة', value: pct(data.avgChange), note: `${formatMoney(data.priorAverage)} متوسط الفترة السابقة.`, tone: data.avgChange != null && data.avgChange < 0 ? 'watch' : 'neutral', perm: 'sales.view' },
      ]) },
      { id: 'customers', label: 'العملاء', icon: Users, headline: 'قيمة العملاء والتحصيل والعودة للشراء', summary: `${data.topCustomers.length} عملاء نشطين في الفترة ضمن النتائج المعروضة، و${data.inactiveCustomers.length} عميل لم يشترِ خلال 60 يومًا أو لا يملك فواتير مسجلة.`, permission: canParties ? undefined : 'parties.view', entries: entries([
        ...data.topCustomers.slice(0, 10).map((r: any) => ({ name: r.name, value: formatMoney(r.total), note: `${r.count} فاتورة · متوسط ${formatMoney(r.avg)} · رصيد ${formatMoney(r.balance)}`, to: `/parties/customer/${r.id}`, perm: 'parties.view' })),
        ...data.inactiveCustomers.slice(0, 10).map((r: any) => ({ name: `عميل متوقف: ${r.name}`, value: r.lastDate || 'لا توجد مشتريات مسجلة', note: `${r.lastDate ? `آخر شراء ${r.lastDate}` : 'لم يظهر له شراء في السجل المحلي'} · رصيد حالي ${formatMoney(r.balance)}. تواصل معه بعرض مناسب بعد مراجعة تفضيلاته.`, tone: 'watch' as const, to: `/parties/customer/${r.id}`, perm: 'parties.view' })),
        { name: 'أعلى متوسط مشتريات للعميل', value: data.topCustomers.length ? formatMoney([...data.topCustomers].sort((a: any, b: any) => b.avg - a.avg)[0].avg) : 'لا توجد بيانات', note: data.topCustomers.length ? [...data.topCustomers].sort((a: any, b: any) => b.avg - a.avg)[0].name : '', perm: 'parties.view' },
        { name: 'مديونية العملاء المتأخرة', value: formatMoney(data.overdueTotal), note: `${data.overdueCount} فاتورة تجاوزت تاريخ الاستحقاق، رصيدها الحالي غير مرتبط بالفترة المختارة.`, tone: data.overdueTotal > 0 ? 'watch' : 'good', to: '/receivables', perm: 'sales.view' },
        ...data.regularCustomerProducts.slice(0, 10).map((r: any) => ({ name: `${r.customerName} · ${r.itemName}`, value: `${r.orders} فواتير`, note: `${formatQty(r.qty)} وحدة في آخر 90 يومًا`, perm: 'parties.view' })),
      ]) },
      { id: 'suppliers', label: 'الموردين', icon: Truck, headline: 'الاعتماد على المورد والأسعار', summary: `تم الشراء من ${data.supplierCount} مورد في الفترة. مقارنة التكلفة تُظهر الأصناف نفسها فقط عندما تتوفر تكلفة مسجلة لدى أكثر من مورد.`, permission: canPurchases ? undefined : 'purchases.view', entries: entries([
        ...data.purchaseShares.slice(0, 10).map((r: any) => ({ name: r.name, value: formatMoney(r.value), note: `${r.share.toFixed(1)}% من المشتريات · ${r.invoices} فاتورة · ${r.itemCount} أصناف`, tone: r.share > 50 ? 'watch' as const : 'neutral' as const, to: `/parties/supplier/${r.id}`, perm: 'parties.view' })),
        { name: 'أفضل مورد في الأصناف المشتركة', value: data.bestSupplier?.[0] ?? 'لا توجد مقارنة', note: data.bestSupplier ? `ظهر الأقل تكلفة في ${data.bestSupplier[1]} مقارنة صنف بين موردين. المقارنة حسب تكلفة الوحدة المسجلة، وليست تقييمًا شاملًا للجودة أو الالتزام.` : 'يلزم شراء نفس الأصناف من أكثر من مورد وتسجيل تكلفتها.', perm: 'costs.view' },
        { name: 'تركيز الشراء على مورد واحد', value: `${data.purchaseShares[0]?.share?.toFixed(1) ?? '0.0'}%`, note: data.purchaseShares[0] ? `أكبر مورد: ${data.purchaseShares[0].name}. لو النسبة عالية، اطلب تسعيرًا بديلًا للأصناف الرئيسية.` : 'لا توجد مشتريات مرحّلة في الفترة.', tone: (data.purchaseShares[0]?.share ?? 0) > 50 ? 'watch' : 'neutral', perm: 'purchases.view' },
        ...data.priceChanges.slice(0, 8).map((r: any) => ({ name: `زيادة تكلفة ${r.name}`, value: `+${r.change.toFixed(1)}%`, note: `${r.supplierName} · متوسط الوحدة ${formatMoney(r.previousUnitCost)} سابقًا ثم ${formatMoney(r.currentUnitCost)} حاليًا.`, tone: 'watch' as const, perm: 'costs.view' })),
        ...data.supplierComparisons.slice(0, 8).map((r: any) => ({ name: `مقارنة ${r.item}`, value: `${r.options[0].supplier}: ${formatMoney(r.options[0].costPerUnit)} / وحدة`, note: r.options.map((x: any) => `${x.supplier}: ${formatMoney(x.costPerUnit)}`).join(' · '), perm: 'costs.view' })),
      ]) },
      { id: 'purchases', label: 'المشتريات', icon: ClipboardList, headline: 'هل المشتريات ماشية مع الحاجة؟', summary: `المشتريات المرحلة ${formatMoney(data.purchases)} مقابل مبيعات ${formatMoney(data.salesNet)}. قارنها برصيد المخزون والطلب قبل الشراء القادم.`, permission: canPurchases ? undefined : 'purchases.view', entries: entries([
        { name: 'المشتريات مقابل المبيعات', value: data.salesNet ? `${(data.purchases * 100 / data.salesNet).toFixed(1)}%` : 'لا توجد مبيعات للمقارنة', note: `المشتريات ${formatMoney(data.purchases)} · التغير عن الفترة السابقة ${pct(data.purchaseChange)}`, tone: data.purchases > data.salesNet ? 'watch' : 'neutral', perm: 'purchases.view' },
        { name: 'أكثر أصناف صرفنا عليها', value: data.purchaseItems.slice(0, 5).map((x: any) => x.name).join('، ') || 'لا توجد بيانات', note: data.purchaseItems.slice(0, 5).map((x: any) => `${x.name}: ${formatMoney(x.value)}`).join(' · ') || 'الأصناف مرتبة حسب قيمة الشراء المسجلة.', perm: 'purchases.view' },
        { name: 'أصناف تحتاج شراء هذا الأسبوع', value: `${data.lowStock.length} صنف`, note: data.lowStock.slice(0, 8).map((r: any) => `${r.name} (${formatQty(r.qty)} / ${formatQty(r.min)})`).join(' · ') || 'لا يوجد صنف تحت حد الطلب المحدد.', tone: data.lowStock.length ? 'watch' : 'good', to: '/reports/reorder', perm: 'inventory.view' },
        { name: 'بضاعة راكدة بعد الشراء', value: formatMoney(data.deadStock.reduce((s: number, r: any) => s + r.value, 0)), note: 'تقدير قيمة التكلفة في الأصناف التي لم تبع خلال 90 يومًا.', tone: data.deadStock.length ? 'watch' : 'neutral', perm: 'costs.view' },
        { name: 'اتجاه تكلفة الشراء', value: pct(data.purchaseChange), note: `المشتريات السابقة ${formatMoney(data.priorPurchases)}. هذه قيمة إجمالية؛ تغير الأسعار للصنف يعرض في قسم الموردين.`, tone: data.purchaseChange != null && data.purchaseChange > 0 ? 'watch' : 'neutral', perm: 'purchases.view' },
        { name: 'لو الميزانية محدودة', value: data.lowStock[0]?.name ?? data.risingItems[0]?.name ?? 'راجع تقرير إعادة الطلب', note: data.lowStock[0] ? `أولوية أولى لأن الرصيد ${formatQty(data.lowStock[0].qty)} عند حد ${formatQty(data.lowStock[0].min)}.` : 'رتّب الشراء حسب حد الطلب وحركة آخر 90 يومًا، وتجنب إعادة شراء الأصناف الراكدة.', to: '/reports/reorder', perm: 'inventory.view' },
      ]) },
      { id: 'employees', label: 'الموظفين', icon: BriefcaseBusiness, headline: 'المبيعات والخصومات والإلغاءات', summary: 'المتاح هو الأداء حسب مندوب البيع المسجل في الفاتورة وتقارير الحضور. ربط كل فاتورة بحساب الموظف غير مسجل بشكل موثوق.', permission: canEmployees ? undefined : 'employees.view', entries: entries([
        ...data.repRows.slice(0, 8).map((r: any) => ({ name: r.name, value: formatMoney(r.sales), note: `${r.count} فاتورة · متوسط ${formatMoney(r.average)} · ${r.priorSales ? `${pctChange(r.sales, r.priorSales)?.toFixed(1)}% عن الفترة السابقة · ` : ''}مرتجعات ${formatMoney(r.returns)} (${r.returnCount}) · خصومات ${formatMoney(r.discount)} · ملغي ${r.cancelled}`, to: '/reports/sales-reps', perm: 'employees.view' })),
        { name: 'الأعلى في متوسط الفاتورة', value: data.repRows.length ? formatMoney([...data.repRows].sort((a: any, b: any) => b.average - a.average)[0].average) : 'بيانات المندوبين غير متاحة', note: data.repRows.length ? [...data.repRows].sort((a: any, b: any) => b.average - a.average)[0].name : 'الفواتير لا تحتوي مندوب بيع مسجل.', perm: 'employees.view' },
        ...data.attendanceStats.slice(0, 6).map((r: any) => ({ name: `الحضور · ${r.employee}`, value: `${r.lateRate.toFixed(1)}% تأخير`, note: `${r.late} تأخيرات من ${r.records} سجل حضور. لا يعني ذلك أداء المبيعات.`, tone: r.lateRate > 20 ? 'watch' as const : 'neutral' as const, perm: 'employees.view' })),
        { name: 'حركة الإلغاء والمرتجعات', value: `${data.canceledSales} فاتورة ملغاة`, note: 'الإلغاء حسب حالة المستند، والمرتجعات حسب مستندات البيع المرتجع ضمن الفترة.', tone: data.canceledSales ? 'watch' : 'neutral', perm: 'sales.view' },
        { name: 'أكثر مندوب خصمًا', value: data.repRows.length ? [...data.repRows].sort((a: any, b: any) => b.discount - a.discount)[0].name : 'غير متاح', note: data.repRows.length ? formatMoney([...data.repRows].sort((a: any, b: any) => b.discount - a.discount)[0].discount) : 'لا توجد فواتير مرتبطة بمندوب بيع.', tone: 'watch', perm: 'employees.view' },
        { name: 'أكثر مندوب في المرتجعات والإلغاء', value: data.repRows.length ? [...data.repRows].sort((a: any, b: any) => (b.returnCount + b.cancelled) - (a.returnCount + a.cancelled))[0].name : 'غير متاح', note: data.repRows.length ? `${[...data.repRows].sort((a: any, b: any) => (b.returnCount + b.cancelled) - (a.returnCount + a.cancelled))[0].returnCount} مرتجع · ${[...data.repRows].sort((a: any, b: any) => (b.returnCount + b.cancelled) - (a.returnCount + a.cancelled))[0].cancelled} إلغاء.` : 'لا توجد فواتير مرتبطة بمندوب بيع.', tone: 'watch', perm: 'employees.view' },
        { name: 'ترتيب حسب مستخدم النظام', value: 'غير متاح', note: 'لا تحتفظ بيانات الفاتورة المحلية بمعرف موثوق لمستخدم الإنشاء ضمن النسخة المسحوبة.', perm: 'employees.view' },
        { name: 'مراجعة الخصومات لكل موظف', value: 'حسب مندوب البيع فقط', note: 'تظهر الخصومات والإلغاءات للمندوب عند تسجيله على الفاتورة؛ لا أنسبها لموظف آخر.', perm: 'employees.view' },
      ]) },
      { id: 'expenses', label: 'المصروفات', icon: WalletCards, headline: 'الفلوس بتتصرف فين؟', summary: `المصروفات والرواتب المسجلة ${formatMoney(data.expenses)}. التغير ${pct(data.expenseChange)} من الفترة السابقة، مع تفصيل البنود المسجلة على حساب.`, permission: canTreasury ? undefined : 'treasury.view', entries: entries([
        { name: 'إجمالي المصروفات والرواتب المسجلة', value: formatMoney(data.expenses), note: `الفترة السابقة ${formatMoney(data.priorExpenses)} · التغير ${pct(data.expenseChange)}`, tone: data.expenseChange != null && data.expenseChange > 0 ? 'watch' : 'neutral', perm: 'treasury.view' },
        ...data.expensesByCategory.slice(0, 12).map((r: any) => ({ name: r.name, value: formatMoney(r.amount), note: `${data.expenses ? (r.amount * 100 / data.expenses).toFixed(1) : '0.0'}% من المصروفات المسجلة`, tone: r.amount === data.expensesByCategory[0]?.amount ? 'watch' as const : 'neutral' as const, perm: 'treasury.view' })),
        { name: 'نسبة المصروفات إلى المبيعات', value: data.salesNet ? `${(data.expenses * 100 / data.salesNet).toFixed(1)}%` : 'لا توجد مبيعات للمقارنة', note: `مصروفات ${formatMoney(data.expenses)} مقابل مبيعات ${formatMoney(data.salesNet)}. لا تمثل كشف دخل محاسبي كامل.`, tone: data.salesNet && data.expenses / data.salesNet > 0.2 ? 'watch' : 'neutral', perm: 'treasury.view' },
        { name: 'ما الذي يمكن تقليله؟', value: data.expensesByCategory[0]?.name ?? 'لا توجد مصروفات مصنفة', note: data.expensesByCategory[0] ? `ابدأ بمراجعة بند ${data.expensesByCategory[0].name} (${formatMoney(data.expensesByCategory[0].amount)})، وقارن ضرورته وتكراره بالفترة السابقة.` : 'سجل المصروفات على بنود واضحة حتى يظهر تحليل خفض الإنفاق.', perm: 'treasury.view' },
      ]) },
    ];
    return areas.map((section) => ({ ...section, entries: section.entries.filter((e) => !e.perm || can(e.perm)) }));
  }, [data, permissionsKey]);

  const selectedSection = sections.find((s) => s.id === activeArea) ?? sections[0];
  const watchCount = sections.flatMap((s) => s.entries).filter((e) => e.tone === 'watch').length;
  const priorities = sections.flatMap((s) => s.entries.filter((e) => e.tone === 'watch').map((e) => ({ ...e, section: s.label }))).slice(0, 5);
  const periodLabel = PERIODS.find((x) => x.key === period)?.label ?? '';

  return <div className="page bi-page bi-full-page">
    <header className="bi-hero"><span className="bi-hero-icon"><Activity /></span><div><h1>تحليل المحل</h1><p>صورة تشغيلية تبيّن الأداء والمشاكل والفرص من بياناتك الفعلية، وتوضح لك الخطوة الأهم.</p></div></header>
    <div className="bi-filterbar"><div><b>تحليل {periodLabel}</b><span>مقارنة بالفترة السابقة المساوية · المستندات المرحلة · البيانات المحلية لهذا المستخدم</span></div><div className="bi-filters"><label>الفترة<select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>{canInventory && <label>المخزن<select className="select" value={selectedWarehouse} onChange={(e) => setWarehouseId(e.target.value)}><option value="">كل المخازن المسموحة</option>{(warehouses ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}</div></div>
    {!data ? <div className="bi-empty">جارٍ تحليل بيانات الجهاز…</div> : <>
      <section className="bi-exec-summary"><div className="bi-exec-copy"><span className="bi-live"><i /> قراءة بيانات الفترة</span><h2>{!data.salesCount ? 'بيانات البيع لا تكفي لتقييم الاتجاه' : data.salesChange == null || data.currentProfitVsPrior == null ? 'البيانات المتاحة لا تكفي لحكم كامل' : data.salesChange >= 0 && data.currentProfitVsPrior >= 0 ? 'أداء البيع والربح يتحسن' : 'فيه نقاط محتاجة متابعة'}</h2><p>{watchCount ? `ظهر ${watchCount} مؤشر يستحق التدخل أو المراجعة.` : data.salesCount ? 'لم تظهر إشارات خطر واضحة في المؤشرات المتاحة.' : 'سجل فواتير مرحّلة أو وسّع الفترة لبدء التحليل.'} النتائج أدناه توضح كل مصدر وتوصية.</p></div><div className="bi-exec-kpis"><div><span>صافي المبيعات</span><b>{formatMoney(data.salesNet)}</b><small>{data.salesChange == null ? 'لا توجد مقارنة' : `${data.salesChange > 0 ? '+' : ''}${data.salesChange.toFixed(1)}% عن الفترة السابقة`}</small></div><div><span>ربح البضاعة</span><b>{data.currentCostKnown ? formatMoney(data.grossProfit) : 'تكلفة ناقصة'}</b><small>{data.currentCostKnown ? `${data.saleInvoices} فاتورة بيع` : 'لا يمكن تأكيد الربح'}</small></div><div><span>بعد المصروفات المسجلة</span><b>{data.currentCostKnown && data.estimatedNetProfit != null ? formatMoney(data.estimatedNetProfit) : 'غير مكتمل'}</b><small>{canTreasury ? 'مبيعات · تكلفة · مصروفات مسجلة' : 'يتطلب صلاحية المصروفات'}</small></div></div></section>
      <nav className="bi-area-nav" aria-label="أقسام تحليل المحل">{sections.map((s) => { const Icon = s.icon; return <button type="button" key={s.id} className={s.id === activeArea ? 'active' : ''} onClick={() => setActiveArea(s.id)}><Icon /><span>{s.label}</span></button>; })}</nav>
      {selectedSection && <section className="bi-area-panel"><div className="bi-area-head"><div><span className="bi-area-label">{selectedSection.label}</span><h2>{selectedSection.headline}</h2><p>{selectedSection.summary}</p></div><span className="bi-area-count">{selectedSection.entries.length} نتيجة</span></div>
        {selectedSection.permission && !can(selectedSection.permission) ? <div className="bi-empty"><CircleHelp /> عرض هذا التحليل يحتاج صلاحية إضافية.</div> : selectedSection.entries.length ? <div className="bi-entry-grid">{selectedSection.entries.map((entry, i) => <article className={`bi-entry ${entry.tone ?? 'neutral'}`} key={`${entry.name}-${i}`}><div className="bi-entry-top"><span>{entry.name}</span>{entry.tone === 'watch' && <AlertTriangle />}</div><b className="bi-entry-value">{entry.value}</b>{entry.note && <p>{entry.note}</p>}{entry.to && (!entry.perm || can(entry.perm)) && <button type="button" className="bi-entry-link" onClick={() => nav(entry.to!)}>افتح التفاصيل <ArrowDownRight /></button>}</article>)}</div> : <div className="bi-empty">لا توجد بيانات كافية في هذا القسم للفترة المختارة. وسّع الفترة أو راجع اكتمال تسجيل الفواتير والحركات.</div>}
      </section>}
      <div className="bi-note"><CircleHelp /> التحليل يعمل على بيانات الجهاز المزامنة، ويحترم صلاحيات المستخدم ونطاق المخازن. لا تشمل النسخة المحلية سجل قيود اليومية الكامل، وقت الفاتورة أو معرف الفرع؛ لذلك لا نعرض صافي ربح محاسبي نهائيًا أو أفضل ساعة أو مقارنة فروع.</div>
      <section className="bi-priorities"><div className="bi-area-head"><div><span className="bi-area-label">خطة تدخل</span><h2>أكبر نقاط تستحق البدء بها</h2><p>مرتبة حسب الإشارات التحذيرية الفعلية التي ظهرت في الأقسام.</p></div><span className="bi-area-count">{priorities.length} أولوية</span></div>{priorities.length ? <div className="bi-entry-grid">{priorities.map((e, i) => <article className="bi-entry watch" key={`${e.section}-${e.name}-${i}`}><div className="bi-entry-top"><span>{e.section} · {e.name}</span><AlertTriangle /></div><b className="bi-entry-value">{e.value}</b>{e.note && <p>{e.note}</p>}{e.to && <button type="button" className="bi-entry-link" onClick={() => nav(e.to!)}>افتح التفاصيل <ArrowDownRight /></button>}</article>)}</div> : <div className="bi-empty">مافيش تحذيرات لها أساس كافٍ في البيانات المختارة.</div>}</section>
    </>}
  </div>;
}
