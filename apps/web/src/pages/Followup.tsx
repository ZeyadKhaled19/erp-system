import { DOC_TYPES, formatMoney, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Empty, exportCsv, Field, Segmented, Sheet, SyncBadge, useUi } from '../components/ui';
import { closeCreditInvoice, settleInstrument } from '../lib/actions';
import { db } from '../lib/db';
import { useMap, usePerm } from '../lib/hooks';

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'مفتوح', cls: 'orange' },
  collected: { label: 'مُحصّل', cls: 'green' },
  bounced: { label: 'مرتد', cls: 'red' },
  closed: { label: 'مغلق', cls: '' },
  cancelled: { label: 'ملغي', cls: '' },
};

/** متابعة الشيكات والأقساط (الواردة من العملاء والصادرة للموردين) — تعمل من النسخة المحلية */
export function InstrumentsPage() {
  const can = usePerm();
  const nav = useNavigate();
  const parties = useMap('parties');
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [until, setUntil] = useState('');
  const [act, setAct] = useState<{ x: any; action: 'collect' | 'bounce' | 'close' } | null>(null);
  const today = todayISO();

  const rows = useLiveQuery(async () => (await db.instruments.toArray()).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))), []) ?? [];
  const list = rows.filter((x) => x.direction === dir && (status === 'all' || x.status === status) && (!kind || x.kind === kind) && (!until || x.due_date <= until));
  const total = list.reduce((s, x) => s + x.amount, 0);
  const overdue = list.filter((x) => x.status === 'open' && x.due_date < today).reduce((s, x) => s + x.amount, 0);

  return (
    <div className="page">
      <PageHeader
        title="الشيكات والأقساط"
        sub={`${list.length} · الإجمالي ${formatMoney(total)}${overdue ? ` · متأخر ${formatMoney(overdue)}` : ''}`}
        actions={<button className="btn" onClick={() => exportCsv('الشيكات والأقساط', ['النوع', 'الطرف', 'الاستحقاق', 'المبلغ', 'رقم الشيك', 'البنك', 'الحالة'], list.map((x) => [x.kind === 'cheque' ? 'شيك' : 'قسط', parties.get(x.party_id)?.name, x.due_date, formatMoney(x.amount), x.cheque_no, x.bank, STATUS[x.status]?.label]))}>تصدير</button>}
      />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented value={dir} onChange={setDir} options={[{ value: 'in', label: 'واردة (من العملاء)' }, { value: 'out', label: 'صادرة (للموردين)' }]} />
        <Segmented value={status} onChange={setStatus} options={[{ value: 'open', label: 'مفتوحة' }, { value: 'collected', label: 'محصلة' }, { value: 'bounced', label: 'مرتدة' }, { value: 'closed', label: 'مغلقة' }, { value: 'all', label: 'الكل' }]} />
        <select className="select" style={{ width: 170 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">شيكات وأقساط</option>
          <option value="cheque">شيكات</option>
          <option value="installment">أقساط</option>
        </select>
        <label className="row small muted">استحقاق حتى <input type="date" className="input" style={{ width: 160 }} value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={<CalendarClock />} title="لا يوجد" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الاستحقاق</th><th>النوع</th><th>الطرف</th><th>رقم الشيك / البنك</th><th>الحالة</th><th className="n">المبلغ</th><th /></tr></thead>
            <tbody>
              {list.map((x) => {
                const late = x.status === 'open' && x.due_date < today;
                return (
                  <tr key={x.id}>
                    <td data-label="الاستحقاق" className={`num ${late ? 'red bold' : ''}`}>{x.due_date}{late ? ' (متأخر)' : ''}</td>
                    <td data-label="النوع">{x.kind === 'cheque' ? 'شيك' : 'قسط'}</td>
                    <td data-label="الطرف">{parties.get(x.party_id)?.name}</td>
                    <td data-label="الشيك" className="small">{x.cheque_no ? <span className="num">{x.cheque_no}</span> : ''}{x.bank ? ` — ${x.bank}` : ''}</td>
                    <td data-label="الحالة"><span className={`badge ${STATUS[x.status]?.cls}`}>{STATUS[x.status]?.label}</span> <SyncBadge sync={x._sync} error={x._error} /></td>
                    <td data-label="المبلغ" className="n bold">{formatMoney(x.amount)}</td>
                    <td data-label="">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {x.document_id && <button className="btn sm plain" onClick={() => nav(`/docs/view/${x.document_id}`)}>الفاتورة</button>}
                        {x.status === 'open' && !x._sync && can('treasury.instruments') && (
                          <>
                            <button className="btn sm primary" onClick={() => setAct({ x, action: 'collect' })}>{x.direction === 'in' ? 'تحصيل' : 'سداد'}</button>
                            {x.kind === 'cheque' && <button className="btn sm danger" onClick={() => setAct({ x, action: 'bounce' })}>ارتداد</button>}
                            <button className="btn sm" onClick={() => setAct({ x, action: 'close' })}>إغلاق</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {act && <SettleSheet x={act.x} action={act.action} partyName={parties.get(act.x.party_id)?.name} onClose={() => setAct(null)} />}
    </div>
  );
}

function SettleSheet({ x, action, partyName, onClose }: { x: any; action: 'collect' | 'bounce' | 'close'; partyName?: string; onClose: () => void }) {
  const ui = useUi();
  const cashboxes = useLiveQuery(async () => (await db.cashboxes.toArray()).filter((c) => c.active !== false), []) ?? [];
  const [cb, setCb] = useState<string>('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const title = action === 'collect' ? (x.direction === 'in' ? 'تحصيل' : 'سداد') : action === 'bounce' ? 'ارتداد شيك' : 'إغلاق المتابعة';
  const effect =
    action === 'collect'
      ? x.kind === 'cheque'
        ? `سيُسجل سند ${x.direction === 'in' ? 'قبض' : 'صرف'} بالمبلغ على الخزينة المختارة مقابل حساب أوراق ${x.direction === 'in' ? 'القبض' : 'الدفع'}.`
        : `سيُسجل سند ${x.direction === 'in' ? 'قبض من' : 'صرف إلى'} ${partyName} ويُخصص على الفاتورة.`
      : action === 'bounce'
        ? `سيُعاد المبلغ مستحقًا على ${partyName} وتعود الفاتورة غير مسددة بقيمة الشيك.`
        : 'تتوقف متابعة هذا البند دون أي أثر محاسبي.';
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>رجوع</button>
          <button
            className={`btn primary ${action === 'bounce' ? 'danger' : ''}`}
            disabled={action === 'collect' && !(cb || cashboxes[0])}
            onClick={async () => {
              await settleInstrument(x, action, { cashbox_id: action === 'collect' ? cb || cashboxes[0]?.id : null, date, note: note || undefined });
              ui.toast('سيُطبق عند المزامنة');
              onClose();
            }}
          >
            تأكيد
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="card pad">
          {x.kind === 'cheque' ? `شيك ${x.cheque_no ?? ''} ${x.bank ?? ''}` : 'قسط'} — {partyName} — <span className="num bold">{formatMoney(x.amount)}</span> — استحقاق <span className="num">{x.due_date}</span>
        </div>
        <div className="footnote">{effect}</div>
        {action === 'collect' && (
          <Field label="الخزينة / البنك">
            <select className="select" value={cb || cashboxes[0]?.id || ''} onChange={(e) => setCb(e.target.value)}>
              {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {action !== 'close' && <Field label="التاريخ"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        <Field label="ملاحظة"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

/** متابعة سداد الفواتير الآجلة: كل فاتورة بحالتها (غير مسدد / جزئي / مسدد) وتاريخ استحقاقها */
export function CreditInvoicesPage() {
  const nav = useNavigate();
  const can = usePerm();
  const ui = useUi();
  const parties = useMap('parties');
  const [kind, setKind] = useState<'sale_invoice' | 'purchase_invoice'>('sale_invoice');
  const [state, setState] = useState<'open' | 'overdue' | 'paid' | 'closed' | 'all'>('open');
  const [party, setParty] = useState('');
  const today = todayISO();
  const docs = useLiveQuery(async () => (await db.documents.where('doc_type').equals(kind).toArray()).filter((d) => d.status === 'posted' && d.party_id !== 'party-cash-customer'), [kind]) ?? [];
  const list = useMemo(
    () =>
      docs
        .filter((d) => {
          const rem = d.total - d.paid;
          if (party && d.party_id !== party) return false;
          if (state === 'open') return rem > 0 && !d.closed;
          if (state === 'overdue') return rem > 0 && !d.closed && d.due_date && d.due_date < today;
          if (state === 'paid') return rem <= 0;
          if (state === 'closed') return d.closed;
          return true;
        })
        .sort((a, b) => String(a.due_date ?? a.date).localeCompare(String(b.due_date ?? b.date))),
    [docs, state, party, today],
  );
  const totals = list.reduce((s, d) => ({ total: s.total + d.total, paid: s.paid + d.paid }), { total: 0, paid: 0 });
  const partyOptions = [...new Set(docs.map((d) => d.party_id))].map((id) => parties.get(id)).filter(Boolean) as any[];

  return (
    <div className="page">
      <PageHeader title="متابعة الفواتير الآجلة" sub={`${list.length} فاتورة · المستحق ${formatMoney(totals.total - totals.paid)}`} />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'sale_invoice', label: 'فواتير البيع' }, { value: 'purchase_invoice', label: 'فواتير الشراء' }]} />
        <Segmented value={state} onChange={setState} options={[{ value: 'open', label: 'غير مسددة' }, { value: 'overdue', label: 'متأخرة' }, { value: 'paid', label: 'مسددة' }, { value: 'closed', label: 'مغلقة' }, { value: 'all', label: 'الكل' }]} />
        <select className="select" style={{ width: 200 }} value={party} onChange={(e) => setParty(e.target.value)}>
          <option value="">كل الأطراف</option>
          {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="footnote" style={{ marginBottom: 10 }}>المقبوضات غير المربوطة بفاتورة تُخصص تلقائيًا على أقدم الفواتير المفتوحة، فتتطابق حالة الفواتير مع رصيد الطرف.</div>
      {list.length === 0 ? (
        <div className="card"><Empty title="لا توجد فواتير" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الاستحقاق</th><th>الفاتورة</th><th>التاريخ</th><th>الطرف</th><th>الحالة</th><th className="n">الإجمالي</th><th className="n">المسدد</th><th className="n">المستحق</th><th /></tr></thead>
            <tbody>
              {list.map((d) => {
                const rem = d.total - d.paid;
                const late = rem > 0 && d.due_date && d.due_date < today;
                const st = rem <= 0 ? ['مسدد', 'green'] : d.paid > 0 ? ['جزئي', 'orange'] : ['غير مسدد', 'red'];
                return (
                  <tr key={d.id}>
                    <td data-label="الاستحقاق" className={`num ${late ? 'red bold' : ''}`}>{d.due_date ?? '—'}</td>
                    <td data-label="الفاتورة" className="num click" onClick={() => nav(`/docs/view/${d.id}`)} style={{ color: 'var(--tint)', cursor: 'pointer' }}>{d.number}</td>
                    <td data-label="التاريخ" className="num">{d.date}</td>
                    <td data-label="الطرف">{parties.get(d.party_id)?.name}</td>
                    <td data-label="الحالة"><span className={`badge ${st[1]}`}>{st[0]}</span> {d.closed && <span className="badge">مغلقة</span>}</td>
                    <td data-label="الإجمالي" className="n">{formatMoney(d.total)}</td>
                    <td data-label="المسدد" className="n">{formatMoney(d.paid)}</td>
                    <td data-label="المستحق" className="n bold">{formatMoney(rem)}</td>
                    <td data-label="">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {rem > 0 && can('treasury.create') && (
                          <button className="btn sm primary" onClick={() => nav(`/docs/new/${kind === 'sale_invoice' ? 'receipt' : 'payment'}?party=${d.party_id}&ref=${d.id}`)}>
                            {kind === 'sale_invoice' ? 'قبض' : 'صرف'}
                          </button>
                        )}
                        {can(kind === 'sale_invoice' ? 'sales.close_credit' : 'purchases.close_credit') && rem > 0 && (
                          <button
                            className="btn sm"
                            onClick={async () => {
                              if (await ui.confirm({ title: d.closed ? 'إعادة فتح المتابعة؟' : 'إغلاق المتابعة؟', message: 'لا يغير هذا أي رصيد؛ فقط يخفي الفاتورة من قائمة المتابعة.' })) await closeCreditInvoice(d, !d.closed);
                            }}
                          >
                            {d.closed ? 'فتح' : 'إغلاق'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="footnote" style={{ marginTop: 10 }}>
        {DOC_TYPES[kind].label}: الإجمالي {formatMoney(totals.total)} · المسدد {formatMoney(totals.paid)}
      </div>
    </div>
  );
}
