import { DOC_TYPES, formatMoney, formatQty, todayISO, type WorkspaceId } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { usePerm, useSession } from '../lib/hooks';
import { useQuickActions } from '../lib/quickActions';
import { DocStatusBadge } from './ui';

/** أي قسم يعرض ملخص أي مساحة عمل */
export const HUB_WORKSPACE: Record<string, WorkspaceId> = { sales: 'sales', inventory: 'inventory', reports: 'accounting' };

interface Kpi {
  label: string;
  value: ReactNode;
  sub?: string;
  to?: string;
  tone?: 'warn' | 'bad';
}

/**
 * ملخص مساحة العمل أعلى صفحة القسم: أرقام من بيانات الجهاز نفسها (نفس طريقة حساب الرئيسية)،
 * كل رقم لا يظهر إلا لمن يملك صلاحيته، ثم أهم الإجراءات، ثم ما يحتاج متابعة.
 */
export function WorkspaceSummary({ ws }: { ws: WorkspaceId }) {
  const can = usePerm();
  const { session } = useSession();
  const permsKey = session.user.permissions.join(',');
  const nav = useNavigate();
  const qa = useQuickActions(ws);
  const today = todayISO();
  const month = today.slice(0, 7) + '-01';

  const data = useLiveQuery(async () => {
    const out: { kpis: Kpi[]; listTitle: string; list: any[]; listKind: 'docs' | 'items'; more?: string } = { kpis: [], listTitle: '', list: [], listKind: 'docs' };
    const sumBal = async (kind: string) => (await db.parties.where('kind').equals(kind).toArray()).reduce((s, p) => s + (p.balance ?? 0), 0);

    if (ws === 'sales') {
      if (can('sales.view')) {
        const docs = (await db.documents.where('date').between(month, today, true, true).toArray()).filter((d) => d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'sale_return'));
        const sign = (d: any) => (d.doc_type === 'sale_invoice' ? d.total : -d.total);
        const todayDocs = docs.filter((d) => d.date === today);
        out.kpis.push({ label: 'مبيعات اليوم', value: formatMoney(todayDocs.reduce((s, d) => s + sign(d), 0)), sub: `${todayDocs.filter((d) => d.doc_type === 'sale_invoice').length} فاتورة`, to: '/invoices' });
        out.kpis.push({ label: 'مبيعات الشهر', value: formatMoney(docs.reduce((s, d) => s + sign(d), 0)), sub: 'بعد المرتجعات', to: can('reports.view') ? '/reports/analysis' : undefined });
        const sales = await db.documents.where('doc_type').equals('sale_invoice').toArray();
        const overdue = sales.filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid && d.due_date && d.due_date < today).length;
        out.kpis.push({ label: 'آجلة متأخرة السداد', value: overdue, to: '/receivables', tone: overdue ? 'warn' : undefined });
        out.listTitle = 'آخر فواتير البيع';
        out.list = sales.sort((a, b) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date))).slice(0, 6);
        out.more = '/invoices';
      }
      if (can('sales.quotation') || can('sales.view')) {
        const q = (await db.documents.where('doc_type').equals('quotation').toArray()).filter((d) => !d.converted_to_id && d.status !== 'cancelled').length;
        out.kpis.push({ label: 'عروض أسعار مفتوحة', value: q, to: '/docs/list/sales' });
      }
      if (can('parties.view')) out.kpis.push({ label: 'مستحق من العملاء', value: formatMoney(await sumBal('customer')), to: '/parties/customer' });
    }

    if (ws === 'inventory') {
      const items = (await db.items.toArray()).filter((i) => i.active !== false);
      if (can('items.view')) out.kpis.push({ label: 'الأصناف النشطة', value: items.length, to: '/items' });
      if (can('inventory.view')) {
        const balances = await db.stock_balances.toArray();
        const qty = new Map<string, number>();
        balances.forEach((b) => qty.set(b.item_id, (qty.get(b.item_id) ?? 0) + b.qty));
        const low = items.filter((i) => !i.is_service && i.reorder_level > 0 && (qty.get(i.id) ?? 0) <= i.reorder_level);
        const out0 = items.filter((i) => !i.is_service && (qty.get(i.id) ?? 0) <= 0);
        out.kpis.push({ label: 'وصلت لحد الطلب', value: low.length, to: '/reports/reorder', tone: low.length ? 'warn' : undefined });
        out.kpis.push({ label: 'نفدت من المخزون', value: out0.length, to: '/reports/stock', tone: out0.length ? 'bad' : undefined });
        if (can('costs.view')) out.kpis.push({ label: 'قيمة المخزون', value: formatMoney(balances.reduce((s, b) => s + (b.value ?? 0), 0)), sub: 'بالتكلفة', to: '/reports/stock' });
        out.listTitle = 'نواقص تحتاج طلب';
        out.listKind = 'items';
        out.list = [...out0, ...low.filter((i) => !out0.includes(i))].slice(0, 6).map((i) => ({ ...i, qty: qty.get(i.id) ?? 0 }));
        out.more = '/reports/reorder';
      }
      if (can('sales.view')) {
        const pend = (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter((d) => d.status === 'posted' && d.deliver_later).length;
        out.kpis.push({ label: 'بانتظار التسليم', value: pend, to: '/deliveries', tone: pend ? 'warn' : undefined });
      }
    }

    if (ws === 'accounting') {
      if (can('treasury.view')) {
        const cash = (await db.cashboxes.toArray()).filter((c) => c.active !== false).reduce((s, c) => s + (c.balance ?? 0), 0);
        out.kpis.push({ label: 'النقدية بالخزائن والبنوك', value: formatMoney(cash), to: '/cashboxes' });
      }
      if (can('parties.view')) {
        out.kpis.push({ label: 'مستحق من العملاء', value: formatMoney(await sumBal('customer')), to: '/parties/customer' });
        out.kpis.push({ label: 'مستحق للموردين', value: formatMoney(await sumBal('supplier')), to: '/parties/supplier' });
      }
      if (can('treasury.view')) {
        const week = new Date();
        week.setDate(week.getDate() + 7);
        const due = (await db.instruments.where('status').equals('open').toArray()).filter((x) => x.due_date <= todayISO(week)).length;
        out.kpis.push({ label: 'شيكات وأقساط خلال أسبوع', value: due, to: '/instruments', tone: due ? 'warn' : undefined });
      }
      const types = [
        ...(can('treasury.view') ? ['receipt', 'payment', 'expense', 'income', 'cash_transfer'] : []),
        ...(can('accounts.view') ? ['journal_voucher', 'party_opening'] : []),
      ];
      if (types.length) {
        const docs = (await db.documents.where('doc_type').anyOf(types).toArray()).sort((a, b) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date)));
        out.listTitle = 'آخر السندات والقيود';
        out.list = docs.slice(0, 6);
        out.more = can('accounts.view') ? '/docs/list/accounts' : '/docs/list/treasury';
      }
    }
    return out;
  }, [ws, today, permsKey]);

  const actions = qa.actions.filter((a) => a.ws.includes(ws) || (qa.usage[a.key] ?? 0) > 0).slice(0, 6);

  return (
    <section className="ws" aria-label="ملخص مساحة العمل">
      {data && data.kpis.length > 0 && (
        <div className="ws-kpis">
          {data.kpis.map((k) => (
            <button key={k.label} type="button" className={`ws-kpi ${k.tone ?? ''}`} onClick={() => k.to && nav(k.to)} disabled={!k.to}>
              <span className="ws-kpi-l">{k.label}</span>
              <span className="ws-kpi-v num">{k.value}</span>
              {k.sub && <span className="ws-kpi-s">{k.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="ws-actions">
          {actions.map((a) => (
            <button key={a.key} type="button" className="btn" onClick={() => { qa.use(a); nav(a.to); }}>
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {data && data.listTitle && (
        <div className="card ws-list">
          <div className="ws-list-h">
            <span>{data.listTitle}</span>
            {data.more && <button type="button" className="btn plain sm" onClick={() => nav(data.more!)}>الكل <ChevronLeft /></button>}
          </div>
          {data.list.length === 0 ? (
            <div className="ws-empty">{data.listKind === 'items' ? 'لا توجد نواقص الآن.' : 'لا توجد مستندات بعد.'}</div>
          ) : data.listKind === 'items' ? (
            data.list.map((i) => (
              <button key={i.id} type="button" className="ws-row" onClick={() => nav(`/items/inquiry?id=${i.id}`)}>
                <span className="ws-row-t">{i.name}<span className="ws-row-s num">{i.code}</span></span>
                <span className={`badge ${i.qty <= 0 ? 'red' : 'orange'}`}>{i.qty <= 0 ? 'نفد' : `متبقي ${formatQty(i.qty)}`}</span>
              </button>
            ))
          ) : (
            data.list.map((d) => (
              <button key={d.id} type="button" className="ws-row" onClick={() => nav(`/docs/view/${d.id}`)}>
                <span className="ws-row-t">
                  {DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label} <span className="ws-row-s num">{d.number ?? d.local_number} · {d.date}</span>
                </span>
                <DocStatusBadge status={d.status} sync={d._sync} />
                <span className="num bold">{formatMoney(d.total ?? d.amount ?? 0)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
