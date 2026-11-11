import { DOC_TYPES, formatMoney, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DocStatusBadge, Empty, SearchBox, Segmented } from '../components/ui';
import { db } from '../lib/db';
import { useDebounced, useMap } from '../lib/hooks';
import { DocumentView } from './DocumentView';

const KINDS: Record<string, { label: string; types: string[] }> = {
  all: { label: 'الكل', types: [] },
  sales: { label: 'مبيعات', types: ['sale_invoice'] },
  purchases: { label: 'مشتريات', types: ['purchase_invoice'] },
  returns: { label: 'مرتجعات', types: ['sale_return', 'purchase_return'] },
  cash: { label: 'سندات', types: ['receipt', 'payment', 'expense', 'income', 'cash_transfer'] },
  quotes: { label: 'عروض أسعار', types: ['quotation'] },
};
const PERIODS: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر', year: 'السنة', all: 'الكل' };

function periodStart(p: string) {
  const d = new Date();
  if (p === 'today') return todayISO(d);
  if (p === 'week') {
    d.setDate(d.getDate() - 6);
    return todayISO(d);
  }
  if (p === 'month') return `${todayISO().slice(0, 7)}-01`;
  if (p === 'year') return `${todayISO().slice(0, 4)}-01-01`;
  return '0000-00-00';
}
function dayLabel(date: string) {
  const t = todayISO();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === t) return 'اليوم';
  if (date === todayISO(y)) return 'أمس';
  return new Date(date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** كل الفواتير والسندات في عرض مقسوم: القائمة على الجانب والتفاصيل بجوارها (مثل Mail على الآيباد) */
export function InvoicesPage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const parties = useMap('parties');
  const [kind, setKind] = useState(sp.get('k') ?? 'all');
  const [period, setPeriod] = useState(sp.get('p') ?? 'month');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const sel = sp.get('id');

  const docs = useLiveQuery(async () => {
    const from = periodStart(period);
    const list = period === 'all' ? await db.documents.toArray() : await db.documents.where('date').aboveOrEqual(from).toArray();
    return list.sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  }, [period]) ?? [];

  const list = useMemo(() => {
    const types = KINDS[kind].types;
    const s = dq.trim().toLowerCase();
    return docs.filter((d) => {
      if (types.length && !types.includes(d.doc_type)) return false;
      if (!types.length && ['journal_voucher', 'stock_transfer', 'stock_adjustment', 'opening_stock', 'party_opening', 'profit_distribution'].includes(d.doc_type)) return false;
      if (!s) return true;
      return [d.number, d.local_number, parties.get(d.party_id)?.name, parties.get(d.party_id)?.phone, d.notes, String(d.total / 100)].some((v) => v?.toLowerCase?.().includes(s));
    });
  }, [docs, kind, dq, parties]);

  const totals = useMemo(() => {
    let sales = 0, purchases = 0, receipts = 0;
    for (const d of list) {
      if (d.status !== 'posted') continue;
      if (d.doc_type === 'sale_invoice') sales += d.total;
      if (d.doc_type === 'sale_return') sales -= d.total;
      if (d.doc_type === 'purchase_invoice') purchases += d.total;
      if (d.doc_type === 'purchase_return') purchases -= d.total;
      if (d.doc_type === 'receipt') receipts += d.total;
    }
    return { sales, purchases, receipts };
  }, [list]);

  const select = (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('id', id);
    setSp(n, { replace: true });
  };
  useEffect(() => {
    const n = new URLSearchParams(sp);
    n.set('k', kind);
    n.set('p', period);
    setSp(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, period]);
  useEffect(() => {
    if (!sel && list[0] && window.innerWidth > 1100) select(list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') === false) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const i = list.findIndex((d) => d.id === sel);
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        e.preventDefault();
        select(next.id);
        document.getElementById(`si-${next.id}`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  let lastDay = '';
  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <PageHeader
        title="الفواتير"
        sub={
          <>
            مبيعات <b className="num">{formatMoney(totals.sales)}</b> · مشتريات <b className="num">{formatMoney(totals.purchases)}</b> · مقبوضات <b className="num">{formatMoney(totals.receipts)}</b>
          </>
        }
      />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented value={kind} onChange={setKind} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Segmented value={period} onChange={setPeriod} options={Object.entries(PERIODS).map(([k, v]) => ({ value: k, label: v }))} />
        <div style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="رقم، عميل، هاتف، مبلغ…" /></div>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={<FileText />} title="لا توجد مستندات" /></div>
      ) : (
        <div className="split">
          <div className="split-list">
            {list.map((d) => {
              const header = d.date !== lastDay ? dayLabel(d.date) : null;
              lastDay = d.date;
              const p = parties.get(d.party_id);
              const sign = d.doc_type.endsWith('_return') || d.doc_type === 'payment' || d.doc_type === 'expense' ? -1 : 1;
              return (
                <div key={d.id}>
                  {header && <div className="split-group">{header}</div>}
                  <div id={`si-${d.id}`} className={`split-item ${sel === d.id ? 'on' : ''}`} onClick={() => (window.innerWidth > 1100 ? select(d.id) : nav(`/docs/view/${d.id}`))}>
                    <div className="si-main">
                      <div className="si-title">{p && p.id !== 'party-cash-customer' ? p.name : DOC_TYPES[d.doc_type as DocType]?.label}</div>
                      <div className="si-sub">
                        {DOC_TYPES[d.doc_type as DocType]?.label} · <span className="num">{d.number ?? d.local_number}</span>
                        {d.doc_type === 'sale_invoice' && d.total > d.paid ? ` · متبقي ${formatMoney(d.total - d.paid)}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div className={`si-amt ${sign < 0 ? 'red' : ''}`}>{formatMoney(d.total)}</div>
                      <DocStatusBadge status={d.status} sync={d._sync} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hide-mobile" style={{ minWidth: 0 }}>
            {sel ? <DocumentView id={sel} embedded /> : <div className="card"><Empty title="اختر مستندًا" /></div>}
          </div>
        </div>
      )}
    </div>
  );
}
