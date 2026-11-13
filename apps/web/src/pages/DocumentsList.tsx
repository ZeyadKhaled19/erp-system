import { DOC_TYPES, formatMoney, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { PageTabs, TREASURY_TABS } from '../components/ListParts';
import { DocStatusBadge, Empty, exportExcel, SearchBox, Segmented } from '../components/ui';
import { db } from '../lib/db';
import { useDebounced, useMap, usePerm } from '../lib/hooks';

const MODULE_LABEL: Record<string, string> = { sales: 'سجل المبيعات', purchases: 'سجل المشتريات', treasury: 'سجل السندات', inventory: 'سجل حركات المخازن', accounts: 'سجل القيود', partners: 'سجل الشركاء' };

/** قائمة المستندات من النسخة المحلية (تعمل دون اتصال) مع ما سُجل على الجهاز ولم يُزامن */
export function DocumentsList() {
  const { module = 'sales' } = useParams();
  const nav = useNavigate();
  const can = usePerm();
  const parties = useMap('parties');
  const types = useMemo(() => (Object.entries(DOC_TYPES) as [DocType, (typeof DOC_TYPES)[DocType]][]).filter(([, i]) => i.module === module), [module]);
  const [type, setType] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());

  const docs = useLiveQuery(async () => {
    const all = await db.documents.where('date').between(from, to, true, true).toArray();
    return all.filter((d) => DOC_TYPES[d.doc_type as DocType]?.module === module).sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  }, [module, from, to]) ?? [];

  const list = docs.filter((d) => {
    if (type && d.doc_type !== type) return false;
    if (status === 'pending' && !d._sync && d.status !== 'pending_review') return false;
    if (status !== 'all' && status !== 'pending' && d.status !== status) return false;
    const s = dq.trim().toLowerCase();
    if (s && ![d.number, d.local_number, parties.get(d.party_id)?.name, d.notes].some((v) => v?.toLowerCase().includes(s))) return false;
    return true;
  });
  const total = list.filter((d) => d.status === 'posted').reduce((s, d) => s + (d.doc_type.endsWith('_return') ? -d.total : d.total), 0);

  return (
    <div className="page">
      {module === 'treasury' && <PageTabs tabs={TREASURY_TABS} />}
      <PageHeader
        title={MODULE_LABEL[module] ?? 'المستندات'}
        sub={`${list.length} مستند · صافي المرحّل ${formatMoney(total)}`}
        actions={
          <>
            <button className="btn" onClick={() => exportExcel(MODULE_LABEL[module], ['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الحالة', 'الإجمالي', 'المدفوع'], list.map((d) => [d.number ?? d.local_number, DOC_TYPES[d.doc_type as DocType].label, d.date, parties.get(d.party_id)?.name, d.status, formatMoney(d.total), formatMoney(d.paid)]))}>
              تصدير
            </button>
            {types[0] && can(`${module === 'accounts' ? 'accounts.journal' : module + '.create'}`) && (
              <button className="btn primary" onClick={() => nav(`/docs/new/${types[0][0]}`)}><Plus /> {types[0][1].label}</button>
            )}
          </>
        }
      />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchBox value={q} onChange={setQ} placeholder="بحث برقم المستند أو الطرف أو الملاحظات" />
        </div>
        <input type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {types.length > 1 && (
          <select className="select" style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">كل الأنواع</option>
            {types.map(([t, i]) => <option key={t} value={t}>{i.label}</option>)}
          </select>
        )}
        <Segmented value={status} onChange={setStatus} options={[{ value: 'all', label: 'الكل' }, { value: 'posted', label: 'مرحّل' }, { value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'معلق/مراجعة' }, { value: 'cancelled', label: 'ملغي' }]} />
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={<FileText />} title="لا توجد مستندات في هذه الفترة" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>الحالة</th><th className="n">الإجمالي</th><th className="n">المتبقي</th></tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/docs/view/${d.id}`)}>
                  <td data-label="الرقم" className="num bold">{d.number ?? d.local_number}</td>
                  <td data-label="النوع">{DOC_TYPES[d.doc_type as DocType].label}</td>
                  <td data-label="التاريخ" className="num">{d.date}</td>
                  <td data-label="الطرف">{parties.get(d.party_id)?.name ?? '—'}</td>
                  <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                  <td data-label="الإجمالي" className="n">{formatMoney(d.total)}</td>
                  <td data-label="المتبقي" className="n">{DOC_TYPES[d.doc_type as DocType].priced && d.total - d.paid ? formatMoney(d.total - d.paid) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
