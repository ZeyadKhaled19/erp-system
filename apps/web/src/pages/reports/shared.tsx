/** أجزاء مشتركة بين صفحات التقارير: الإطار وفترة التاريخ وقوائم الأصناف والمخازن */
import { DOC_TYPES, formatMoney, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileDown, Printer } from 'lucide-react';
import { type ReactNode } from 'react';
import { PageHeader } from '../../components/Layout';
import { Banner, Field, savePdf } from '../../components/ui';
import { db } from '../../lib/db';
import { useSettings } from '../../lib/hooks';

export const monthStart = () => `${todayISO().slice(0, 7)}-01`;

export const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;

export const docLabel = (t: string) => DOC_TYPES[t as DocType]?.label ?? t;

export function Shell({ title, sub, filters, actions, error, loading, children, note }: { title: string; sub?: ReactNode; filters?: ReactNode; actions?: ReactNode; error?: string | null; loading?: boolean; children: ReactNode; note?: ReactNode }) {
  const settings = useSettings();
  return (
    <div className="page">
      <div className="print-only" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{settings.company_name}</div>
        <div>{title} — طُبع {new Date().toLocaleString('ar-EG')}</div>
      </div>
      <PageHeader title={title} sub={sub} actions={<>{actions}<button className="btn" title="احفظ التقرير كملف PDF (اختر «حفظ كـ PDF» في نافذة الطباعة)" onClick={() => savePdf(title)}><FileDown /> PDF</button><button className="btn" onClick={() => window.print()}><Printer /> طباعة</button></>} />
      {filters && <div className="card pad no-print" style={{ marginBottom: 14 }}><div className="grid grid-4" style={{ alignItems: 'end' }}>{filters}</div></div>}
      {error && <div style={{ marginBottom: 12 }}><Banner kind="warn">{error}</Banner></div>}
      {loading && <div className="muted" style={{ marginBottom: 8 }}>جارٍ التحميل…</div>}
      {children}
      {note && <div className="footnote" style={{ marginTop: 12 }}>{note}</div>}
    </div>
  );
}

export function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <>
      <Field label="من تاريخ"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="إلى تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </>
  );
}

export function useItemOptions() {
  return useLiveQuery(async () => {
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c.name]));
    return (await db.items.orderBy('code').toArray()).map((i) => ({ id: i.id, label: i.name, sub: i.code, search: `${i.name} ${i.code} ${i.barcode ?? ''}`, group: (i.category_id && cats.get(i.category_id)) || undefined }));
  }, []) ?? [];
}

export function useWarehouses() {
  return useLiveQuery(() => db.warehouses.orderBy('code').toArray(), []) ?? [];
}

export function Kpi({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${strong && v < 0 ? 'red' : ''}`} style={{ fontSize: strong ? 26 : 22 }}>{formatMoney(v)}</div>
    </div>
  );
}

export function Section({ title, rows, total }: { title: string; rows: any[]; total: number }) {
  return (
    <div>
      <div className="group-header">{title}</div>
      <div className="list">
        {rows.length === 0 && <div className="list-row muted">لا يوجد</div>}
        {rows.map((x) => (
          <div key={x.id} className="list-row">
            <span className="num muted" style={{ width: 56 }}>{x.code}</span>
            <div className="title">{x.name}</div>
            <span className={`num ${x.net < 0 ? 'red' : ''}`}>{formatMoney(x.net)}</span>
          </div>
        ))}
        <div className="list-row"><div className="title bold">الإجمالي</div><span className="num bold">{formatMoney(total)}</span></div>
      </div>
    </div>
  );
}
