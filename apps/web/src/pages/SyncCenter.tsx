import { DOC_TYPES, formatMoney, formatQty } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, Field, Segmented, Sheet, useUi } from '../components/ui';
import { resolveConflict } from '../lib/actions';
import { db, type OutboxEntry } from '../lib/db';
import { usePerm, useSyncCounts, useSyncState } from '../lib/hooks';
import { getDeviceId } from '../lib/session';
import { useNegativeStock } from './Reports';
import { discardOutboxEntry, syncNow } from '../lib/sync';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'بانتظار الإرسال', cls: 'orange' },
  accepted: { label: 'تم القبول', cls: 'green' },
  rejected: { label: 'مرفوضة', cls: 'red' },
  conflict: { label: 'تعارض/مراجعة', cls: 'red' },
};

export function SyncCenter() {
  const s = useSyncState();
  const c = useSyncCounts();
  const can = usePerm();
  const ui = useUi();
  const nav = useNavigate();
  const negative = useNegativeStock();
  const [tab, setTab] = useState<'queue' | 'problems' | 'conflicts' | 'done'>('queue');
  const [resolving, setResolving] = useState<any | null>(null);

  const entries = useLiveQuery(async () => (await db.outbox.toArray()).reverse(), []) ?? [];
  const conflicts = useLiveQuery(async () => (await db.sync_conflicts.toArray()).filter((x) => x.status === 'open' || x.status === 'resolving').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), []) ?? [];
  const list = entries.filter((e) =>
    tab === 'queue' ? e.status === 'pending' : tab === 'problems' ? (e.status === 'rejected' && e.message !== 'تم التجاهل') || e.status === 'conflict' : e.status === 'accepted' || e.message === 'تم التجاهل',
  ).slice(0, 300);
  const reachable = s.online && s.serverReachable;

  return (
    <div className="page">
      <PageHeader
        title="مركز المزامنة"
        sub={`هذا الجهاز: ${getDeviceId().slice(0, 8)}`}
        actions={<button className="btn primary" onClick={() => void syncNow()} disabled={s.syncing}><RefreshCw className={s.syncing ? 'spin' : ''} /> مزامنة الآن</button>}
      />
      <div className="grid grid-4">
        <div className="card stat">
          <div className="stat-label">الاتصال</div>
          <div className="row" style={{ fontSize: 20, fontWeight: 700 }}>
            {reachable ? <CheckCircle2 color="var(--green)" /> : <CloudOff color="var(--gray)" />}
            {reachable ? 'متصل بالخادم' : 'دون اتصال'}
          </div>
          <div className="caption">{s.lastSyncAt ? `آخر مزامنة: ${new Date(s.lastSyncAt).toLocaleString('ar-EG')}` : 'لم تتم مزامنة بعد'}</div>
        </div>
        <div className="card stat"><div className="stat-label">بانتظار الإرسال</div><div className="stat-value num">{c.pending}</div></div>
        <div className="card stat"><div className="stat-label">مرفوضة</div><div className={`stat-value num ${c.rejected ? 'red' : ''}`}>{c.rejected}</div></div>
        <div className="card stat"><div className="stat-label">تعارضات مفتوحة (للشركة)</div><div className={`stat-value num ${c.conflicts ? 'red' : ''}`}>{c.conflicts}</div></div>
      </div>
      {negative.length > 0 && can('inventory.view') && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="warn">
            بعد المزامنة: {negative.length} صنف رصيده سالب (بيع أكثر من المتاح، غالبًا من أكثر من جهاز). الفواتير مسجلة كما هي ولم تُسقط.{' '}
            <button className="btn sm" onClick={() => nav('/reports/negative')}>مراجعة الأرصدة السالبة</button>
          </Banner>
        </div>
      )}
      {s.lastError && !reachable && <div style={{ marginTop: 12 }}><Banner kind="info">{s.lastError}. كل ما تسجله محفوظ على الجهاز وسيُرسل تلقائيًا عند عودة الاتصال.</Banner></div>}

      <div style={{ margin: '20px 0 12px' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'queue', label: `الطابور (${c.pending})` },
            { value: 'problems', label: `تحتاج معالجة (${c.rejected})` },
            { value: 'conflicts', label: `التعارضات (${conflicts.length})` },
            { value: 'done', label: 'المكتملة' },
          ]}
        />
      </div>

      {tab !== 'conflicts' &&
        (list.length === 0 ? (
          <div className="card"><Empty icon={<CheckCircle2 />} title={tab === 'queue' ? 'لا توجد عمليات معلقة' : tab === 'problems' ? 'لا توجد مشكلات' : 'لا يوجد'} /></div>
        ) : (
          <div className="list">
            {list.map((e) => (
              <OutboxRow
                key={e.seq}
                e={e}
                onOpen={() => (e.entity === 'document' ? nav(`/docs/view/${e.entity_id}`) : undefined)}
                onDiscard={async () => {
                  if (await ui.confirm({ title: 'تجاهل هذه العملية؟', message: 'لن تُرسل مرة أخرى. إذا كانت إنشاء سجل جديد لم يصل للخادم سيُحذف من هذا الجهاز.', confirmLabel: 'تجاهل', destructive: true })) {
                    await discardOutboxEntry(e.seq!);
                  }
                }}
              />
            ))}
          </div>
        ))}

      {tab === 'conflicts' &&
        (conflicts.length === 0 ? (
          <div className="card"><Empty icon={<CheckCircle2 />} title="لا توجد تعارضات مفتوحة" /></div>
        ) : (
          <div className="list">
            {conflicts.map((x) => (
              <div key={x.id} className="list-row">
                <div className="title">
                  <div className="bold">{x.message}</div>
                  <div className="sub">{KIND[x.kind] ?? x.kind} · {new Date(x.created_at).toLocaleString('ar-EG')}</div>
                </div>
                {x.status === 'resolving' ? (
                  <span className="badge orange">جارٍ الحل</span>
                ) : can('conflicts.resolve') ? (
                  <button className="btn sm primary" onClick={() => setResolving(x)}>معالجة</button>
                ) : (
                  <span className="caption">يحتاج مستخدمًا مخولًا</span>
                )}
              </div>
            ))}
          </div>
        ))}

      {resolving && <ResolveSheet conflict={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); ui.toast('سيُطبق القرار عند المزامنة'); }} />}
    </div>
  );
}

const KIND: Record<string, string> = { edit_conflict: 'تعديل متزامن من جهازين', stock_shortage: 'عجز في رصيد المخزون', credit_limit: 'تجاوز الحد الائتماني' };

function OutboxRow({ e, onOpen, onDiscard }: { e: OutboxEntry; onOpen: () => void; onDiscard: () => void }) {
  const st = e.message === 'تم التجاهل' ? { label: 'تم التجاهل', cls: '' } : STATUS[e.status];
  return (
    <div className="list-row tappable" onClick={onOpen}>
      <div className="title">
        <div>{e.label}</div>
        <div className="sub">
          سُجلت {new Date(e.created_at).toLocaleString('ar-EG')}
          {e.attempts > 0 && ` · محاولات الإرسال: ${e.attempts}`}
          {e.result?.number ? ` · الرقم الرسمي ${e.result.number}` : ''}
        </div>
        {e.message && e.message !== 'تم التجاهل' && <div className="sub" style={{ color: e.status === 'pending' ? 'var(--label-2)' : 'var(--red)' }}>{e.message}</div>}
      </div>
      <span className={`badge ${st.cls}`}>{st.label}</span>
      {e.status === 'rejected' && e.message !== 'تم التجاهل' && (
        <button className="btn sm" onClick={(ev) => { ev.stopPropagation(); onDiscard(); }}>تجاهل</button>
      )}
    </div>
  );
}

function ResolveSheet({ conflict, onClose, onDone }: { conflict: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const nav = useNavigate();
  const isDoc = conflict.entity === 'document';
  const doc = useLiveQuery(() => (isDoc ? db.documents.get(conflict.entity_id) : undefined), [conflict.entity_id]);
  const act = async (r: 'keep_server' | 'apply_client' | 'post_anyway' | 'discard') => {
    await resolveConflict(conflict, r, note || undefined);
    onDone();
  };
  const fields = conflict.kind === 'edit_conflict' && !isDoc ? Object.keys(conflict.client_data ?? {}).filter((k) => k !== 'units' && JSON.stringify(conflict.client_data[k]) !== JSON.stringify(conflict.server_data?.[k])) : [];
  const fmt = (k: string, v: any) => (v == null ? '—' : /price|limit|cost/.test(k) ? formatMoney(v) : /level/.test(k) ? formatQty(v) : typeof v === 'boolean' ? (v ? 'نعم' : 'لا') : String(v));
  return (
    <Sheet title="معالجة تعارض" onClose={onClose} wide>
      <div className="stack">
        <Banner kind="warn">{conflict.message}</Banner>
        {conflict.kind === 'stock_shortage' && conflict.server_data && (
          <div className="card pad">
            المتاح وقت الترحيل: <span className="num bold">{formatQty(conflict.server_data.available)}</span> — المطلوب: <span className="num bold">{formatQty(conflict.server_data.requested)}</span>
          </div>
        )}
        {doc && (
          <div className="list-row tappable card" onClick={() => nav(`/docs/view/${doc.id}`)}>
            <div className="title">{DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES]?.label} {doc.number} · {doc.date}</div>
            <span className="num">{formatMoney(doc.total)}</span>
          </div>
        )}
        {fields.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الحقل</th><th>القيمة الحالية على الخادم</th><th>التعديل الوارد من الجهاز</th></tr></thead>
              <tbody>
                {fields.map((k) => (
                  <tr key={k}><td>{k}</td><td>{fmt(k, conflict.server_data?.[k])}</td><td className="bold">{fmt(k, conflict.client_data?.[k])}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Field label="ملاحظة القرار (تُحفظ في سجل التدقيق)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="stack">
          {conflict.kind === 'edit_conflict' && (
            <>
              <button className="btn block lg" onClick={() => act('keep_server')}>الإبقاء على النسخة الحالية (تجاهل التعديل الوارد)</button>
              <button className="btn primary block lg" onClick={() => act('apply_client')}>تطبيق التعديل الوارد من الجهاز</button>
            </>
          )}
          {(conflict.kind === 'stock_shortage' || conflict.kind === 'credit_limit') && (
            <>
              <button className="btn primary block lg" onClick={() => act('post_anyway')}>
                {conflict.kind === 'stock_shortage' ? 'ترحيل رغم العجز (الرصيد سيصبح سالبًا حتى التسوية)' : 'ترحيل رغم تجاوز الحد'}
              </button>
              <button className="btn block lg" onClick={() => act('keep_server')}>إرجاع المستند مسودة لتعديله</button>
              <button className="btn danger block lg" onClick={() => act('discard')}>رفض وإلغاء المستند</button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
