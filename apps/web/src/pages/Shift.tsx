import { formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Banner, Field, MoneyInput, useUi } from '../components/ui';
import { closeShift, openShift } from '../lib/actions';
import { db } from '../lib/db';
import { useRemote, useSession } from '../lib/hooks';

/** وردية الكاشير: فتح بعهدة، وإقفال بجرد نقدي، والفرق يُسجل عجزًا أو زيادة */
export function ShiftPage() {
  const { session } = useSession();
  const ui = useUi();
  const cashboxes = useLiveQuery(async () => (await db.cashboxes.toArray()).filter((c) => c.active !== false && c.kind === 'cash'), []) ?? [];
  const shifts = useLiveQuery(async () => (await db.cashier_shifts.where('user_id').equals(session.user.id).toArray()).sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))), []) ?? [];
  const open = shifts.find((s) => s.status === 'open');
  const [cb, setCb] = useState('');
  const [float, setFloat] = useState(0);
  const [counted, setCounted] = useState(0);
  const [notes, setNotes] = useState('');
  const exp = useRemote<any>(open && !open._sync ? `/api/shifts/${open.id}/expected` : null, [open?.row_version]);
  const cbName = (id: string) => cashboxes.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="page narrow">
      <PageHeader title="الوردية" sub={session.user.full_name} />
      {!open ? (
        <div className="card pad stack">
          <div className="row"><Clock /> <span className="bold">لا توجد وردية مفتوحة</span></div>
          <Field label="الخزينة (درج النقدية)">
            <select className="select" value={cb || cashboxes[0]?.id || ''} onChange={(e) => setCb(e.target.value)}>
              {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="عهدة البداية (النقدية الموجودة في الدرج الآن)"><MoneyInput value={float} onChange={setFloat} /></Field>
          <button
            className="btn primary lg"
            disabled={!(cb || cashboxes[0])}
            onClick={async () => {
              await openShift(uuid(), cb || cashboxes[0].id, float, session.user.id);
              ui.toast('فُتحت الوردية');
            }}
          >
            فتح الوردية
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="card pad stack">
            <div className="row"><span className="badge green">مفتوحة</span><span className="bold">{cbName(open.cashbox_id)}</span><span className="spacer" /><span className="caption">منذ {new Date(open.opened_at).toLocaleString('ar-EG')}</span></div>
            {open._sync && <Banner kind="info">الوردية بانتظار المزامنة؛ المتوقع يظهر بعد قبولها على الخادم.</Banner>}
            <div className="list" style={{ background: 'var(--bg)' }}>
              <div className="list-row" style={{ background: 'transparent' }}><div className="title">عهدة البداية</div><span className="num">{formatMoney(open.opening_float)}</span></div>
              {exp.data && <div className="list-row" style={{ background: 'transparent' }}><div className="title">صافي حركة الوردية</div><span className="num">{formatMoney(exp.data.movement)}</span></div>}
              {exp.data && <div className="list-row" style={{ background: 'transparent' }}><div className="title bold">المتوقع في الدرج</div><span className="num bold">{formatMoney(exp.data.expected)}</span></div>}
            </div>
            {exp.error && <Banner kind="warn">{exp.error}</Banner>}
          </div>
          <div className="card pad stack">
            <Field label="النقدية الفعلية بعد العد"><MoneyInput value={counted} onChange={setCounted} /></Field>
            {exp.data && <div className={`bold ${counted - exp.data.expected < 0 ? 'red' : counted - exp.data.expected > 0 ? 'green' : ''}`}>الفرق: {formatMoney(counted - exp.data.expected)} {counted - exp.data.expected < 0 ? '(عجز)' : counted - exp.data.expected > 0 ? '(زيادة)' : ''}</div>}
            <Field label="ملاحظات"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <button
              className="btn primary lg"
              onClick={async () => {
                const ok = await ui.confirm({ title: 'إقفال الوردية؟', message: 'يُحسب الفرق بين المتوقع والفعلي ويُسجل قيد عجز/زيادة الخزينة إن وجد.', confirmLabel: 'إقفال' });
                if (!ok) return;
                await closeShift(open.id, counted, todayISO(), notes || undefined);
                ui.toast('أُقفلت الوردية');
              }}
            >
              إقفال الوردية
            </button>
          </div>
        </div>
      )}
      <div className="section-title">الورديات السابقة</div>
      <div className="list">
        {shifts.filter((s) => s.status === 'closed').slice(0, 30).map((s) => (
          <div key={s.id} className="list-row">
            <div className="title">{cbName(s.cashbox_id)}<div className="sub">{new Date(s.opened_at).toLocaleString('ar-EG')} ← {s.closed_at ? new Date(s.closed_at).toLocaleString('ar-EG') : ''}</div></div>
            <span className="num">{s.counted_cash != null ? formatMoney(s.counted_cash) : ''}</span>
            {s.difference ? <span className={`badge ${s.difference < 0 ? 'red' : 'green'}`}>{formatMoney(s.difference)}</span> : <span className="badge green">مطابق</span>}
          </div>
        ))}
        {!shifts.some((s) => s.status === 'closed') && <div className="list-row muted">لا يوجد</div>}
      </div>
    </div>
  );
}
