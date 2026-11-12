import { DOC_TYPES, formatMoney, hasPermission, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, FileText, FilterX, Plus, Receipt, RotateCcw, ShoppingBag, ShoppingCart, TrendingUp, Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DocStatusBadge, Empty, exportCsv, SearchBox } from '../components/ui';
import { db } from '../lib/db';
import { useDebounced, useMap, useSession } from '../lib/hooks';
import { DocumentView } from './DocumentView';

const KINDS: Record<string, { label: string; types: string[]; perm: string[] }> = {
  all: { label: 'الكل', types: [], perm: [] },
  sales: { label: 'مبيعات', types: ['sale_invoice'], perm: ['sales.view'] },
  purchases: { label: 'مشتريات', types: ['purchase_invoice'], perm: ['purchases.view'] },
  returns: { label: 'مرتجعات', types: ['sale_return', 'purchase_return'], perm: ['sales.view', 'purchases.view'] },
  cash: { label: 'سندات', types: ['receipt', 'payment', 'expense', 'income', 'cash_transfer'], perm: ['treasury.view'] },
  quotes: { label: 'عروض أسعار', types: ['quotation'], perm: ['sales.view', 'sales.quotation'] },
};
const HIDDEN_IN_ALL = ['journal_voucher', 'stock_transfer', 'stock_adjustment', 'opening_stock', 'party_opening', 'profit_distribution', 'year_closing', 'partner_capital', 'partner_withdrawal'];
const PERIODS: Record<string, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر 7 أيام',
  d30: 'آخر 30 يومًا',
  month: 'هذا الشهر',
  lastmonth: 'الشهر الماضي',
  m3: 'آخر 3 شهور',
  quarter: 'هذا الربع',
  year: 'هذه السنة',
  lastyear: 'السنة الماضية',
  all: 'كل الفترات',
  custom: 'من تاريخ إلى تاريخ…',
};
const STATUSES: Record<string, string> = { '': 'كل الحالات', posted: 'مرحّلة', draft: 'مسودة', sync: 'بانتظار المزامنة', review: 'تحتاج مراجعة', cancelled: 'ملغاة' };
const PAYS: Record<string, string> = { '': 'كل حالات السداد', paid: 'مدفوعة بالكامل', partial: 'مدفوعة جزئيًا', unpaid: 'آجلة (غير مدفوعة)' };

/** شكل كل نوع مستند في القائمة */
export const DOC_LOOK: Record<string, { icon: ReactNode; tone: string }> = {
  sale_invoice: { icon: <ShoppingCart />, tone: 'green' },
  sale_return: { icon: <RotateCcw />, tone: 'purple' },
  purchase_invoice: { icon: <ShoppingBag />, tone: 'amber' },
  purchase_return: { icon: <Undo2 />, tone: 'orange' },
  receipt: { icon: <ArrowDownLeft />, tone: 'teal' },
  payment: { icon: <ArrowUpRight />, tone: 'red' },
  expense: { icon: <Receipt />, tone: 'red' },
  income: { icon: <TrendingUp />, tone: 'teal' },
  cash_transfer: { icon: <ArrowLeftRight />, tone: 'slate' },
  quotation: { icon: <FileText />, tone: 'pink' },
};
export const lookOf = (t: string) => DOC_LOOK[t] ?? { icon: <FileText />, tone: 'slate' };

/** حالة السداد لفواتير البيع والشراء */
export function payState(d: any): { key: 'paid' | 'partial' | 'unpaid' | 'closed'; label: string; pct: number } | null {
  if (!['sale_invoice', 'purchase_invoice'].includes(d.doc_type) || d.status === 'cancelled' || d.status === 'draft') return null;
  const pct = d.total > 0 ? Math.min(100, Math.round((d.paid * 100) / d.total)) : 100;
  if (d.paid >= d.total) return { key: 'paid', label: 'مدفوعة', pct: 100 };
  if (d.closed) return { key: 'closed', label: 'مغلقة', pct };
  if (d.paid > 0) return { key: 'partial', label: `جزئي ${pct}%`, pct };
  return { key: 'unpaid', label: 'آجل', pct: 0 };
}

function periodRange(p: string, from: string, to: string): [string, string] {
  const now = new Date();
  const t = todayISO(now);
  const back = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return todayISO(d);
  };
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (yy: number, mm: number, dd: number) => todayISO(new Date(yy, mm, dd));
  if (p === 'today') return [t, t];
  if (p === 'yesterday') return [back(1), back(1)];
  if (p === 'week') return [back(6), t];
  if (p === 'd30') return [back(29), t];
  if (p === 'month') return [`${t.slice(0, 7)}-01`, t];
  if (p === 'lastmonth') return [iso(y, m - 1, 1), iso(y, m, 0)];
  if (p === 'm3') return [iso(y, m - 2, 1), t];
  if (p === 'quarter') return [iso(y, Math.floor(m / 3) * 3, 1), t];
  if (p === 'year') return [`${y}-01-01`, t];
  if (p === 'lastyear') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  if (p === 'custom') return [from || '0000-00-00', to || '9999-12-31'];
  return ['0000-00-00', '9999-12-31'];
}
function dayLabel(date: string) {
  const t = todayISO();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === t) return 'اليوم';
  if (date === todayISO(y)) return 'أمس';
  return new Date(date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : '');

/** مركز الفواتير: ملخص، فلاتر واضحة، قائمة مجمعة باليوم، وتفاصيل منظمة بجوارها */
export function InvoicesPage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const parties = useMap('parties');
  const get = (k: string, d = '') => sp.get(k) ?? d;
  const [kind, setKind] = useState(get('k', 'all'));
  const [period, setPeriod] = useState(get('p', 'month'));
  const [from, setFrom] = useState(get('from'));
  const [to, setTo] = useState(get('to'));
  const [status, setStatus] = useState(get('st'));
  const [pay, setPay] = useState(get('pay'));
  const [sort, setSort] = useState(get('sort', 'new'));
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const sel = sp.get('id');
  const kinds = Object.entries(KINDS).filter(([, v]) => !v.perm.length || v.perm.some((p) => can(p)));

  const [start, end] = periodRange(period, from, to);
  const docs = useLiveQuery(async () => {
    const list = period === 'all' ? await db.documents.toArray() : await db.documents.where('date').between(start, end, true, true).toArray();
    // لا تظهر إلا مستندات الوحدات المسموح بمشاهدتها
    return list.filter((d) => {
      const m = DOC_TYPES[d.doc_type as DocType]?.module;
      return !!m && hasPermission(session.user.permissions, `${m}.view`);
    });
  }, [start, end, period, session.user.permissions.join(',')]) ?? [];

  // كل الفلاتر عدا النوع (لعدّ كل تبويب)
  const base = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return docs.filter((d) => {
      if (status === 'posted' && (d.status !== 'posted' || d._sync)) return false;
      if (status === 'draft' && d.status !== 'draft') return false;
      if (status === 'cancelled' && d.status !== 'cancelled') return false;
      if (status === 'sync' && !(d._sync === 'pending' || d._sync === 'rejected')) return false;
      if (status === 'review' && !(d.status === 'pending_review' || d._sync === 'conflict')) return false;
      if (pay) {
        const ps = payState(d);
        if (!ps || (pay === 'paid' ? ps.key !== 'paid' : pay === 'partial' ? ps.key !== 'partial' : ps.key !== 'unpaid')) return false;
      }
      if (!s) return true;
      const p = parties.get(d.party_id);
      return [d.number, d.local_number, p?.name, p?.phone, d.notes, String(d.total / 100)].some((v) => v?.toLowerCase?.().includes(s));
    });
  }, [docs, status, pay, dq, parties]);
  const ofKind = (k: string, d: any) => {
    const types = KINDS[k].types;
    return types.length ? types.includes(d.doc_type) : !HIDDEN_IN_ALL.includes(d.doc_type);
  };
  const counts = useMemo(() => Object.fromEntries(Object.keys(KINDS).map((k) => [k, base.filter((d) => ofKind(k, d)).length])), [base]);
  const list = useMemo(() => {
    const l = base.filter((d) => ofKind(kind, d));
    return sort === 'amount'
      ? l.sort((a, b) => b.total - a.total)
      : l.sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  }, [base, kind, sort]);

  const sum = useMemo(() => {
    const r = { sales: 0, salesN: 0, purchases: 0, purchasesN: 0, receipts: 0, receiptsN: 0, due: 0, dueN: 0 };
    for (const d of list) {
      if (d.status !== 'posted') continue;
      if (d.doc_type === 'sale_invoice') { r.sales += d.total; r.salesN++; if (!d.closed && d.total > d.paid) { r.due += d.total - d.paid; r.dueN++; } }
      if (d.doc_type === 'sale_return') r.sales -= d.total;
      if (d.doc_type === 'purchase_invoice') { r.purchases += d.total; r.purchasesN++; }
      if (d.doc_type === 'purchase_return') r.purchases -= d.total;
      if (d.doc_type === 'receipt') { r.receipts += d.total; r.receiptsN++; }
    }
    return r;
  }, [list]);

  const select = (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('id', id);
    setSp(n, { replace: true });
  };
  useEffect(() => {
    const n = new URLSearchParams(sp);
    const put = (k: string, v: string, def = '') => (v && v !== def ? n.set(k, v) : n.delete(k));
    put('k', kind, 'all');
    put('p', period, 'month');
    put('from', period === 'custom' ? from : '');
    put('to', period === 'custom' ? to : '');
    put('st', status);
    put('pay', pay);
    put('sort', sort, 'new');
    setSp(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, period, from, to, status, pay, sort]);
  useEffect(() => {
    if ((!sel || !list.some((d) => d.id === sel)) && list[0] && window.innerWidth > 1100) select(list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, kind, period, status, pay]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
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

  const activeFilters = (status ? 1 : 0) + (pay ? 1 : 0) + (dq ? 1 : 0) + (period !== 'month' ? 1 : 0) + (kind !== 'all' ? 1 : 0);
  const clearAll = () => {
    setKind('all');
    setPeriod('month');
    setStatus('');
    setPay('');
    setQ('');
    setSort('new');
  };
  const dayTotals = useMemo(() => {
    const m = new Map<string, { n: number; v: number }>();
    for (const d of list) {
      const x = m.get(d.date) ?? { n: 0, v: 0 };
      x.n++;
      if (d.status === 'posted' && d.doc_type === 'sale_invoice') x.v += d.total;
      if (d.status === 'posted' && d.doc_type === 'sale_return') x.v -= d.total;
      m.set(d.date, x);
    }
    return m;
  }, [list]);

  const exportList = () =>
    exportCsv(
      'الفواتير',
      ['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
      list.map((d) => [d.number ?? d.local_number, DOC_TYPES[d.doc_type as DocType]?.label, d.date, parties.get(d.party_id)?.name ?? '', formatMoney(d.total), formatMoney(d.paid ?? 0), formatMoney((d.total ?? 0) - (d.paid ?? 0)), d.status]),
    );

  const showSales = kind === 'all' || kind === 'sales' || kind === 'returns';
  const showPurch = kind === 'all' || kind === 'purchases' || kind === 'returns';
  const showCash = kind === 'all' || kind === 'cash';

  let lastDay = '';
  return (
    <div className="page inv-page">
      <PageHeader
        title="الفواتير"
        sub={`${list.length} مستند · ${PERIODS[period].replace('…', '')}${period !== 'all' ? ` (${start === '0000-00-00' ? 'البداية' : start} ← ${end === '9999-12-31' ? 'اليوم' : end})` : ''}`}
        actions={
          <>
            <button className="btn" onClick={exportList} disabled={!list.length}><Download /> تصدير</button>
            {can('purchases.create') && <button className="btn" onClick={() => nav('/docs/new/purchase_invoice')}><Plus /> فاتورة شراء</button>}
            {can('sales.create') && <button className="btn primary" onClick={() => nav('/docs/new/sale_invoice')}><Plus /> فاتورة بيع</button>}
          </>
        }
      />

      {/* الملخص */}
      <div className="inv-kpis">
        {showSales && can('sales.view') && (
          <button className={`inv-kpi green ${kind === 'sales' ? 'on' : ''}`} onClick={() => setKind('sales')}>
            <span className="inv-kpi-l"><ShoppingCart /> صافي المبيعات</span>
            <span className="inv-kpi-v num">{formatMoney(sum.sales)}</span>
            <span className="inv-kpi-s">{sum.salesN} فاتورة · بعد المرتجعات</span>
          </button>
        )}
        {showSales && can('sales.view') && (
          <button className={`inv-kpi red ${pay === 'unpaid' || pay === 'partial' ? 'on' : ''}`} onClick={() => { setKind('sales'); setPay(pay === 'unpaid' ? '' : 'unpaid'); }}>
            <span className="inv-kpi-l"><Receipt /> متبقي على العملاء</span>
            <span className="inv-kpi-v num">{formatMoney(sum.due)}</span>
            <span className="inv-kpi-s">{sum.dueN} فاتورة غير مسددة بالكامل</span>
          </button>
        )}
        {showPurch && can('purchases.view') && (
          <button className={`inv-kpi amber ${kind === 'purchases' ? 'on' : ''}`} onClick={() => setKind('purchases')}>
            <span className="inv-kpi-l"><ShoppingBag /> صافي المشتريات</span>
            <span className="inv-kpi-v num">{formatMoney(sum.purchases)}</span>
            <span className="inv-kpi-s">{sum.purchasesN} فاتورة</span>
          </button>
        )}
        {showCash && can('treasury.view') && (
          <button className={`inv-kpi teal ${kind === 'cash' ? 'on' : ''}`} onClick={() => setKind('cash')}>
            <span className="inv-kpi-l"><ArrowDownLeft /> المقبوضات</span>
            <span className="inv-kpi-v num">{formatMoney(sum.receipts)}</span>
            <span className="inv-kpi-s">{sum.receiptsN} سند قبض</span>
          </button>
        )}
      </div>

      {/* الفلاتر */}
      <div className="card inv-filters">
        <div className="inv-tabs" role="tablist" aria-label="نوع المستند">
          {kinds.map(([k, v]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {v.label} <span className="num">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="inv-frow">
          <div className="inv-search"><SearchBox value={q} onChange={setQ} placeholder="رقم الفاتورة، اسم العميل، الهاتف، المبلغ…" /></div>
          <select
            className="select"
            aria-label="الفترة"
            value={period}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom' && !from && !to) {
                const [a, b] = periodRange(period === 'all' ? 'month' : period, '', '');
                setFrom(a);
                setTo(b);
              }
              setPeriod(v);
            }}
          >
            {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {period === 'custom' && (
            <>
              <label className="inv-date"><span>من</span><input type="date" className="input" aria-label="من تاريخ" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="inv-date"><span>إلى</span><input type="date" className="input" aria-label="إلى تاريخ" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          )}
          <select className="select" aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {(kind === 'all' || kind === 'sales' || kind === 'purchases') && (
            <select className="select" aria-label="السداد" value={pay} onChange={(e) => setPay(e.target.value)}>
              {Object.entries(PAYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <select className="select" aria-label="الترتيب" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="new">الأحدث أولًا</option>
            <option value="amount">الأكبر مبلغًا</option>
          </select>
          {activeFilters > 0 && <button className="btn plain sm" onClick={clearAll}><FilterX /> مسح الفلاتر</button>}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<FileText />} title="لا توجد مستندات مطابقة">
            {activeFilters > 0 ? 'جرّب تغيير الفترة أو مسح الفلاتر.' : 'ابدأ بإنشاء فاتورة بيع أو شراء.'}
          </Empty>
        </div>
      ) : (
        <div className="inv-split">
          <div className="inv-list" role="listbox" aria-label="المستندات">
            {list.map((d) => {
              const header = sort === 'new' && d.date !== lastDay ? d.date : null;
              lastDay = d.date;
              const p = parties.get(d.party_id);
              const look = lookOf(d.doc_type);
              const ps = payState(d);
              const dt = header ? dayTotals.get(header) : null;
              const out = ['sale_return', 'purchase_invoice', 'payment', 'expense'].includes(d.doc_type);
              return (
                <div key={d.id}>
                  {header && (
                    <div className="inv-day">
                      <span>{dayLabel(header)}</span>
                      <span className="num">{dt?.n} مستند{dt && dt.v ? ` · مبيعات ${formatMoney(dt.v)}` : ''}</span>
                    </div>
                  )}
                  <div
                    id={`si-${d.id}`}
                    role="option"
                    aria-selected={sel === d.id}
                    tabIndex={0}
                    className={`inv-item ${sel === d.id ? 'on' : ''} ${d.status === 'cancelled' ? 'cancelled' : ''}`}
                    onClick={() => (window.innerWidth > 1100 ? select(d.id) : nav(`/docs/view/${d.id}`))}
                    onKeyDown={(e) => e.key === 'Enter' && (window.innerWidth > 1100 ? select(d.id) : nav(`/docs/view/${d.id}`))}
                  >
                    <span className={`inv-ic t-${look.tone}`}>{look.icon}</span>
                    <div className="inv-main">
                      <div className="inv-title">{p && p.id !== 'party-cash-customer' ? p.name : p?.id === 'party-cash-customer' ? 'عميل نقدي' : DOC_TYPES[d.doc_type as DocType]?.label}</div>
                      <div className="inv-meta">
                        {DOC_TYPES[d.doc_type as DocType]?.label} · <span className="num">{d.number ?? d.local_number}</span>
                        {d.created_at && sort === 'new' ? <> · <span className="num">{timeOf(d.created_at)}</span></> : sort === 'amount' ? <> · <span className="num">{d.date}</span></> : null}
                      </div>
                      {ps && ps.key !== 'paid' && (
                        <div className="inv-progress" title={`مدفوع ${formatMoney(d.paid)} من ${formatMoney(d.total)}`}>
                          <i style={{ width: `${ps.pct}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="inv-side">
                      <div className={`inv-amt num ${out ? 'out' : ''}`}>{formatMoney(d.total)}</div>
                      <div className="inv-chips">
                        {(d.status !== 'posted' || d._sync) && <DocStatusBadge status={d.status} sync={d._sync} />}
                        {ps && <span className={`inv-pay ${ps.key}`}>{ps.label}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="inv-detail hide-mobile">
            {sel ? <DocumentView id={sel} embedded /> : <div className="card"><Empty title="اختر مستندًا لعرض تفاصيله" /></div>}
          </div>
        </div>
      )}
    </div>
  );
}
