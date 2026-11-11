import { formatMoney, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Landmark, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Field, Segmented, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useRemote } from '../lib/hooks';

export function CashboxesPage() {
  const can = usePerm();
  const ui = useUi();
  const nav = useNavigate();
  const boxes = useLiveQuery(() => db.cashboxes.toArray(), []) ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());
  const current = boxes.find((b) => b.id === sel) ?? boxes[0];
  const mv = useRemote<any>(current && !current._sync ? `/api/reports/cashbox/${current.id}?from=${from}&to=${to}` : null, [current?.row_version]);

  return (
    <div className="page">
      <PageHeader
        title="الخزائن والبنوك"
        sub={`الإجمالي ${formatMoney(boxes.reduce((s, b) => s + (b.balance ?? 0), 0))}`}
        actions={can('treasury.manage') && <button className="btn primary" onClick={() => setEdit({})}><Plus /> خزينة/بنك</button>}
      />
      <div className="grid grid-3">
        {boxes.map((b) => (
          <div key={b.id} className="card stat" style={{ cursor: 'pointer', outline: current?.id === b.id ? '2px solid var(--tint)' : undefined }} onClick={() => setSel(b.id)}>
            <div className="row">
              <span className="stat-icon" style={{ background: b.kind === 'bank' ? '#5856D6' : '#34C759' }}>{b.kind === 'bank' ? <Landmark /> : <Wallet />}</span>
              <span className="stat-label" style={{ flex: 1 }}>{b.name} {b.active === false && <span className="badge">موقوفة</span>}</span>
              <SyncBadge sync={b._sync} error={b._error} />
              {can('treasury.manage') && <button className="btn sm plain" onClick={(e) => { e.stopPropagation(); setEdit(b); }}>تعديل</button>}
            </div>
            <div className="stat-value num" style={{ textAlign: 'start' }}>{formatMoney(b.balance ?? 0)}</div>
          </div>
        ))}
      </div>

      {current && (
        <>
          <div className="row wrap" style={{ margin: '22px 0 10px' }}>
            <div className="section-title" style={{ margin: 0, flex: 1 }}>حركة {current.name}</div>
            <input type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {mv.error && <Banner kind="warn">{mv.error}</Banner>}
          {mv.data && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th className="n">وارد</th><th className="n">منصرف</th><th className="n">الرصيد</th></tr></thead>
                <tbody>
                  <tr><td colSpan={5} className="muted">رصيد أول المدة</td><td className="n bold">{formatMoney(mv.data.opening)}</td></tr>
                  {mv.data.lines.map((l: any, i: number) => (
                    <tr key={i} className={l.document_id ? 'click' : ''} onClick={() => l.document_id && nav(`/docs/view/${l.document_id}`)}>
                      <td data-label="التاريخ" className="num">{l.date}</td>
                      <td data-label="المستند" className="num">{l.doc_number}</td>
                      <td data-label="البيان">{l.memo ?? l.entry_memo}{l.party_name ? ` — ${l.party_name}` : ''}</td>
                      <td data-label="وارد" className="n green">{l.debit ? formatMoney(l.debit) : ''}</td>
                      <td data-label="منصرف" className="n red">{l.credit ? formatMoney(l.credit) : ''}</td>
                      <td data-label="الرصيد" className="n bold">{formatMoney(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={5}>الرصيد الختامي</td><td className="n">{formatMoney(mv.data.closing)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {edit && (
        <CashboxEditor
          box={edit.id ? edit : null}
          onClose={() => setEdit(null)}
          onSave={async (d) => {
            await saveMaster('cashbox', edit.id ?? uuid(), d, edit.id ? edit : null);
            ui.toast('تم الحفظ');
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CashboxEditor({ box, onClose, onSave }: { box: any | null; onClose: () => void; onSave: (d: any) => void }) {
  const [f, setF] = useState({ name: box?.name ?? '', kind: box?.kind ?? 'cash', active: box?.active ?? true });
  return (
    <Sheet title={box ? 'تعديل خزينة' : 'خزينة / حساب بنكي جديد'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={!f.name.trim()} onClick={() => onSave(f)}>حفظ</button></>}>
      <div className="stack">
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        {!box && (
          <Field label="النوع" hint="يُنشأ لها حساب فرعي تلقائيًا في دليل الحسابات">
            <Segmented block value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'cash', label: 'خزينة نقدية' }, { value: 'bank', label: 'حساب بنكي' }]} />
          </Field>
        )}
        <div className="row"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} /> {f.active ? 'نشطة' : 'موقوفة'}</div>
        <div className="footnote">لتسجيل رصيد افتتاحي للخزينة استخدم «قيد يومية»: مدين الخزينة، دائن «أرصدة افتتاحية».</div>
      </div>
    </Sheet>
  );
}
