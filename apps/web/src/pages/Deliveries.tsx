import { formatQty, mulDiv, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { PackageCheck, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, Field, QtyInput, SearchBox, Segmented, Sheet, SyncBadge, useUi } from '../components/ui';
import { recordDelivery, setDocMeta } from '../lib/actions';
import { db } from '../lib/db';
import { useMap, usePerm } from '../lib/hooks';

/** متابعة فواتير البيع مؤجلة التسليم: غير مسلّمة / جزئي / مسلّمة، والتسليم على مراحل */
export function DeliveriesPage() {
  const nav = useNavigate();
  const can = usePerm();
  const parties = useMap('parties');
  const [state, setState] = useState<'pending' | 'partial' | 'done' | 'all'>('pending');
  const [q, setQ] = useState('');
  const [deliver, setDeliver] = useState<any | null>(null);
  const [meta, setMeta] = useState<any | null>(null);

  const data = useLiveQuery(async () => {
    const docs = (await db.documents.where('doc_type').equals('sale_invoice').toArray()).filter((d) => d.deliver_later && d.status === 'posted');
    const out: any[] = [];
    for (const d of docs) {
      const lines = await db.document_lines.where('document_id').equals(d.id).toArray();
      const qty = lines.reduce((s, l) => s + l.base_qty, 0);
      const delivered = lines.reduce((s, l) => s + (l.delivered_qty ?? 0), 0);
      out.push({ ...d, lines, qty, delivered });
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, []) ?? [];

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((d) => {
      const st = d.delivered === 0 ? 'pending' : d.delivered < d.qty ? 'partial' : 'done';
      if (state !== 'all' && (state === 'pending' ? st === 'done' : st !== state)) return false;
      return !s || [d.number, d.local_number, parties.get(d.party_id)?.name, d.shipping_company, d.order_status].some((v) => v?.toLowerCase?.().includes(s));
    });
  }, [data, state, q, parties]);

  // الكميات المحجوزة للتسليم لكل صنف (موجودة فعليًا بالمخزن رغم خصمها دفتريًا)
  const pendingByItem = useMemo(() => {
    const m = new Map<string, number>();
    data.forEach((d) => d.lines.forEach((l: any) => m.set(l.item_id, (m.get(l.item_id) ?? 0) + (l.base_qty - (l.delivered_qty ?? 0)))));
    return [...m.entries()].filter(([, v]) => v > 0);
  }, [data]);
  const items = useMap('items');

  return (
    <div className="page">
      <PageHeader title="متابعة تسليم فواتير البيع" sub={`${list.length} فاتورة`} />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented value={state} onChange={setState} options={[{ value: 'pending', label: 'لم تكتمل' }, { value: 'partial', label: 'جزئي' }, { value: 'done', label: 'مسلّمة' }, { value: 'all', label: 'الكل' }]} />
        <div style={{ flex: 1, minWidth: 200 }}><SearchBox value={q} onChange={setQ} placeholder="رقم الفاتورة أو العميل أو شركة الشحن أو الحالة" /></div>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={<Truck />} title="لا توجد فواتير" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>حالة الطلب</th><th>شركة الشحن</th><th>التسليم</th><th /></tr></thead>
            <tbody>
              {list.map((d) => {
                const pct = d.qty ? Math.round((d.delivered * 100) / d.qty) : 100;
                return (
                  <tr key={d.id}>
                    <td data-label="الفاتورة" className="num" style={{ color: 'var(--tint)', cursor: 'pointer' }} onClick={() => nav(`/docs/view/${d.id}`)}>{d.number ?? d.local_number} <SyncBadge sync={d._sync} error={d._error} /></td>
                    <td data-label="التاريخ" className="num">{d.date}</td>
                    <td data-label="العميل">{parties.get(d.party_id)?.name}</td>
                    <td data-label="حالة الطلب">{d.order_status || '—'}</td>
                    <td data-label="الشحن">{d.shipping_company || '—'}</td>
                    <td data-label="التسليم"><span className={`badge ${pct >= 100 ? 'green' : pct > 0 ? 'orange' : 'red'}`}>{pct >= 100 ? 'مسلّمة' : pct > 0 ? `جزئي ${pct}%` : 'لم تُسلّم'}</span></td>
                    <td data-label="">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {can('sales.deliver') && <button className="btn sm" onClick={() => setMeta(d)}>الحالة</button>}
                        {can('sales.deliver') && pct < 100 && !d._sync && <button className="btn sm primary" onClick={() => setDeliver(d)}><PackageCheck /> تسليم</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingByItem.length > 0 && (
        <>
          <div className="section-title">كميات بانتظار التسليم (محجوزة بالمخزن)</div>
          <div className="list">
            {pendingByItem.map(([id, qty]) => (
              <div key={id} className="list-row"><div className="title">{items.get(id)?.name}</div><span className="num bold">{formatQty(qty)} {items.get(id)?.base_unit}</span></div>
            ))}
          </div>
          <div className="group-footer">هذه الكميات مخصومة من رصيد المخزن دفتريًا عند ترحيل الفاتورة لكنها ما زالت موجودة فعليًا حتى تسليمها.</div>
        </>
      )}

      {deliver && <DeliverSheet doc={deliver} onClose={() => setDeliver(null)} />}
      {meta && <MetaSheet doc={meta} onClose={() => setMeta(null)} />}
    </div>
  );
}

export function DeliverSheet({ doc, onClose }: { doc: any; onClose: () => void }) {
  const ui = useUi();
  const items = useMap('items');
  const lines = useLiveQuery(() => db.document_lines.where('document_id').equals(doc.id).sortBy('line_no'), [doc.id]) ?? [];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const open = lines.filter((l) => l.base_qty - (l.delivered_qty ?? 0) > 0 && !items.get(l.item_id)?.is_service);

  const submit = async () => {
    setErr(null);
    const out = [];
    for (const l of open) {
      // الإدخال بوحدة السطر، والتسليم يُسجل بالوحدة الأساسية
      const q = qty[l.id] ?? 0;
      if (q <= 0) continue;
      const base = mulDiv(q, l.unit_factor, 1000);
      const remaining = l.base_qty - (l.delivered_qty ?? 0);
      const it = items.get(l.item_id);
      if (base > remaining) return setErr(`كمية «${it?.name}» أكبر من المتبقي`);
      const sl = (serials[l.id] ?? '').split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean);
      if (it?.track_serial && sl.length !== base / 1000) return setErr(`أدخل ${base / 1000} رقم سيريال للصنف «${it.name}»`);
      out.push({ line_id: l.id, qty: base, serials: it?.track_serial ? sl : [] });
    }
    if (!out.length) return setErr('حدد كمية واحدة على الأقل');
    await recordDelivery(doc, date, out, notes || undefined);
    ui.toast('سُجل التسليم');
    onClose();
  };

  return (
    <Sheet
      title={`تسليم من فاتورة ${doc.number ?? doc.local_number}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, mulDiv(l.base_qty - (l.delivered_qty ?? 0), 1000, l.unit_factor)])))}>تسليم الكل</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={submit}>تسجيل التسليم</button>
        </>
      }
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <div className="grid grid-2">
          <Field label="تاريخ التسليم"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="ملاحظات"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="table-wrap" style={{ background: 'var(--bg-elevated)' }}>
          <table className="table">
            <thead><tr><th>الصنف</th><th className="n">الكمية</th><th className="n">المسلّم</th><th className="n">المتبقي</th><th>تسليم الآن</th></tr></thead>
            <tbody>
              {open.map((l) => {
                const it = items.get(l.item_id);
                const rem = mulDiv(l.base_qty - (l.delivered_qty ?? 0), 1000, l.unit_factor);
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="bold">{it?.name}</div>
                      {it?.track_serial && (
                        <input className="input num" style={{ marginTop: 6 }} placeholder="أرقام السيريال (مسافة أو فاصلة)" value={serials[l.id] ?? ''} onChange={(e) => setSerials({ ...serials, [l.id]: e.target.value })} />
                      )}
                    </td>
                    <td className="n">{formatQty(l.qty)} {l.unit_name}</td>
                    <td className="n">{formatQty(mulDiv(l.delivered_qty ?? 0, 1000, l.unit_factor))}</td>
                    <td className="n bold">{formatQty(rem)}</td>
                    <td style={{ width: 130 }}><QtyInput value={qty[l.id] ?? 0} onChange={(v) => setQty({ ...qty, [l.id]: v })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open.length === 0 && <Banner kind="ok">كل أصناف الفاتورة سُلّمت.</Banner>}
      </div>
    </Sheet>
  );
}

function MetaSheet({ doc, onClose }: { doc: any; onClose: () => void }) {
  const ui = useUi();
  const [status, setStatus] = useState(doc.order_status ?? '');
  const [ship, setShip] = useState(doc.shipping_company ?? '');
  const presets = ['قيد التجهيز', 'جاهز للشحن', 'مع شركة الشحن', 'تم التسليم', 'مرتجع'];
  return (
    <Sheet
      title="حالة الطلب والشحن"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" onClick={async () => { await setDocMeta(doc, status || null, ship || null); ui.toast('تم الحفظ'); onClose(); }}>حفظ</button></>}
    >
      <div className="stack">
        <Field label="حالة الطلب">
          <input className="input" list="order-status-presets" value={status} onChange={(e) => setStatus(e.target.value)} />
          <datalist id="order-status-presets">{presets.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="شركة الشحن"><input className="input" value={ship} onChange={(e) => setShip(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}
