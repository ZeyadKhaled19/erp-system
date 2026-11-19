import { DOC_TYPES, formatMoney, formatQty, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Truck, Users, Wallet, UserCheck, FileClock, ArrowDownLeft, ArrowUpRight, ShoppingBag, ShoppingCart, Phone, MapPin } from 'lucide-react';
import { QuickActions, SectionHeader, SectionStats } from '../components/Section';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DateInput, DocStatusBadge, Empty, exportExcel, savePdf, Field, MoneyInput, SearchBox, Segmented, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { PartyInsights } from '../components/Insights';
import { PartyGroupSheet } from '../components/CustomerFields';
import { customOf, fieldValueText, PartyFieldInputs, PartyFieldsManager, usePartyFields } from '../components/PartyFields';
import { ActiveBadge, PageTabs, RowActions } from '../components/ListParts';
import { db } from '../lib/db';
import { useDebounced, usePerm, useRemote } from '../lib/hooks';
import './parties.css';

const KIND_LABEL = { customer: { one: 'عميل', many: 'العملاء', bal: 'مستحق عليه' }, supplier: { one: 'مورد', many: 'الموردون', bal: 'مستحق له' } } as const;

export function PartiesPage() {
  const { kind = 'customer' } = useParams() as { kind: 'customer' | 'supplier' };
  const can = usePerm();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'balance' | 'due' | 'credit'>('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [grp, setGrp] = useState('');
  const [grpSheet, setGrpSheet] = useState<any | undefined>(undefined);
  // فلتر بخانة حرة: «id الخانة:id الاختيار» أو «id الخانة:__none» (الرابط القديم ?brand= بيفضل شغال)
  const [ff, setFf] = useState(() => {
    const u = new URLSearchParams(window.location.search);
    return u.get('field') ?? (u.get('brand') ? `pf-scooter-brand:${u.get('brand')}` : '');
  });
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fields = usePartyFields(kind);
  const listFields = fields.filter((f) => f.kind === 'list');
  const groups = useLiveQuery(async () => (await db.party_groups.where('kind').equals(kind).toArray()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), [kind]) ?? [];
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const [editing, setEditing] = useState<any | null>(null);
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    if (sp.get('new') === '1') {
      if (can('parties.create')) setEditing({ kind });
      sp.delete('new');
      setSp(sp, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, kind]);
  const dq = useDebounced(q);
  const L = KIND_LABEL[kind];
  const parties = useLiveQuery(() => db.parties.where('kind').equals(kind).sortBy('code'), [kind]) ?? [];
  const list = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return parties.filter((p) => (!grp || p.group_id === grp)
      && (!ff || (() => { const [fid, oid] = ff.split(':'); const v = customOf(p)[fid]; return oid === '__none' ? !v : v === oid; })())
      && (activeFilter === 'all' || (activeFilter === 'active' ? p.active !== false : p.active === false))
      && (!s || [p.name, p.code, p.phone].some((v) => v?.toLowerCase().includes(s)))
      && (filter === 'all' || (filter === 'due' && (p.balance ?? 0) > 0) || (filter === 'credit' && (p.balance ?? 0) < 0) || (filter === 'balance' && (p.balance ?? 0) !== 0)))
      .sort((a, b) => sort === 'balance' ? (b.balance ?? 0) - (a.balance ?? 0) : a.name.localeCompare(b.name, 'ar'));
  }, [parties, dq, filter, grp, ff, activeFilter, sort]);
  const total = list.reduce((s, p) => s + (p.balance ?? 0), 0);
  // مؤشرات القسم من كل العملاء/الموردين (مش من نتيجة البحث)
  const activeParties = parties.filter((p) => p.active !== false);
  const withBal = parties.filter((p) => (p.balance ?? 0) !== 0);
  const allBal = parties.reduce((s, p) => s + Math.max(0, p.balance ?? 0), 0);
  const reverseBalance = parties.reduce((s, p) => s + Math.max(0, -(p.balance ?? 0)), 0);
  const allowedTypes = Object.entries(DOC_TYPES).filter(([, info]) => can(`${info.module}.view`)).map(([type]) => type);
  const activity = useLiveQuery(async () => {
    if (!allowedTypes.length) return new Map<string, string>();
    const docs = await db.documents.where('doc_type').anyOf(allowedTypes).toArray();
    const result = new Map<string, string>();
    for (const d of docs) if (d.status === 'posted' && d.party_id && d.date > (result.get(d.party_id) ?? '')) result.set(d.party_id, d.date);
    return result;
  }, [allowedTypes.join(',')]) ?? new Map<string, string>();
  const openDocs = useLiveQuery(async () => {
    if (!can(kind === 'customer' ? 'sales.view' : 'purchases.view')) return null;
    const t = kind === 'customer' ? 'sale_invoice' : 'purchase_invoice';
    return (await db.documents.where('doc_type').equals(t).toArray()).filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid).length;
  }, [kind, allowedTypes.join(',')]);

  return (
    <div className="page parties-page">
      <PageTabs tabs={[{ to: '/parties/customer', label: 'العملاء' }, { to: '/parties/supplier', label: 'الموردون' }]} />
      <SectionHeader
        icon={kind === 'customer' ? <Users /> : <Truck />}
        color={kind === 'customer' ? 'teal' : 'purple'}
        title={L.many}
        sub={`${list.length} حساب · صافي الرصيد المعروض: ${formatMoney(total)}`}
        tools={
          <>
            <button className="btn" onClick={() => exportExcel(L.many, ['الكود', 'الاسم', 'الهاتف', 'الرصيد'], list.map((p) => [p.code, p.name, p.phone, formatMoney(p.balance ?? 0)]))}>
              تصدير Excel
            </button>
            {can('parties.create') && (
              <button className="btn primary" onClick={() => setEditing({ kind })}>
                <Plus /> {L.one} جديد
              </button>
            )}
          </>
        }
      />
      <div className="sx-top">
        <SectionStats items={[
          { key: 'count', label: kind === 'customer' ? 'العملاء النشطين' : 'الموردين النشطين', value: activeParties.length, sub: `من ${parties.length}`, icon: <Users />, color: 'blue' },
          { key: 'bal', label: kind === 'customer' ? 'مستحق لنا من العملاء' : 'مستحق علينا للموردين', value: formatMoney(allBal), sub: 'الأرصدة الموجبة فقط', icon: <Wallet />, color: kind === 'customer' ? 'orange' : 'purple' },
          { key: 'reverse', label: kind === 'customer' ? 'أرصدة لصالح العملاء' : 'أرصدة لنا عند الموردين', value: formatMoney(reverseBalance), sub: 'الأرصدة العكسية بالقيمة المطلقة', icon: <Wallet />, color: 'green' },
          { key: 'withbal', label: 'لهم رصيد', value: withBal.length, icon: <UserCheck />, color: 'teal' },
          ...(openDocs != null ? [{ key: 'open', label: kind === 'customer' ? 'فواتير بيع آجلة' : 'فواتير شراء آجلة', value: openDocs, sub: 'غير مسددة بالكامل', icon: <FileClock />, color: 'red' as const, to: '/receivables' }] : []),
        ]} />
        <QuickActions section={`parties-${kind}`} defaults={kind === 'customer' ? ['customer_new', 'receipt', 'sale_invoice', 'quotation'] : ['supplier_new', 'payment', 'purchase_invoice', 'purchase_return']} />
      </div>
      <div className="card party-list-filters">
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو الكود أو الهاتف" />
        </div>
        <select className="select" aria-label="فلتر الرصيد" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">كل الأرصدة</option><option value="due">{kind === 'customer' ? 'عليهم مستحقات' : 'لهم مستحقات'}</option><option value="credit">{kind === 'customer' ? 'رصيد لصالح العميل' : 'رصيد لصالحنا'}</option><option value="balance">كل من له رصيد</option></select>
        <select className="select" aria-label="حالة الطرف" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">موقوف</option></select>
        <select className="select" aria-label="ترتيب الأطراف" value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">الاسم أبجديًا</option><option value="balance">الأعلى مستحقًا</option></select>
      </div>
      {kind === 'customer' && (
        <div className="seg-chips" style={{ marginBottom: 12 }}>
          <button className={!grp ? 'on' : ''} onClick={() => setGrp('')}>كل الأنواع</button>
          {groups.map((g) => (
            <button key={g.id} className={grp === g.id ? 'on' : ''} style={g.active === false ? { opacity: 0.5 } : undefined} onClick={() => setGrp(g.id)} onDoubleClick={() => can('parties.edit') && setGrpSheet(g)} title="اضغط مرتين للتعديل">
              {g.name} <span className="muted small num">{parties.filter((p) => p.group_id === g.id).length}</span>
            </button>
          ))}
          {can('parties.edit') && grp && <button onClick={() => setGrpSheet(groups.find((g) => g.id === grp))}><Pencil /> تعديل النوع</button>}
          {can('parties.create') && <button onClick={() => setGrpSheet(null)}><Plus /> نوع جديد</button>}
        </div>
      )}
      {(listFields.length > 0 || can('settings.manage')) && (
        <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
          {listFields.length > 0 && (
            <select className="select" style={{ width: 260 }} value={ff} onChange={(e) => setFf(e.target.value)} aria-label="فلتر بخانات العملاء">
              <option value="">{listFields.length === 1 ? `كل ${listFields[0].name}` : 'كل الخانات'}</option>
              {listFields.map((f) => (
                <optgroup key={f.id} label={f.name}>
                  {f.options.map((o) => <option key={o.id} value={`${f.id}:${o.id}`}>{o.name}{o.active === false ? ' (موقوف)' : ''}</option>)}
                  <option value={`${f.id}:__none`}>من غير {f.name}</option>
                </optgroup>
              ))}
            </select>
          )}
          {can('settings.manage') && <button className="btn" onClick={() => setFieldsOpen(true)}>خانات بيانات {L.many}</button>}
        </div>
      )}
      {grpSheet !== undefined && <PartyGroupSheet group={grpSheet} onClose={() => setGrpSheet(undefined)} onSaved={(id) => setGrp(id)} />}
      {fieldsOpen && <PartyFieldsManager kind={kind} onClose={() => setFieldsOpen(false)} />}
      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<Users />} title="لا يوجد" />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                {kind === 'customer' && <th>النوع</th>}
                {fields.map((f) => <th key={f.id}>{f.name}</th>)}
                <th className="n">الرصيد</th>
                <th>آخر تعامل</th><th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/parties/${kind}/${p.id}`)}>
                  <td data-label="الكود" className="num">{p.code}</td>
                  <td data-label="الاسم" className="bold">
                    {p.name}
                  </td>
                  <td data-label="الهاتف" className="num muted">{p.phone ?? '—'}</td>
                  {kind === 'customer' && <td data-label="النوع">{p.group_id ? <span className="badge">{groupName.get(p.group_id) ?? '—'}</span> : <span className="muted">—</span>}</td>}
                  {fields.map((f) => { const t = fieldValueText(f, customOf(p)[f.id]); return <td key={f.id} data-label={f.name}>{t || <span className="muted">—</span>}</td>; })}
                  <td data-label="الرصيد" className={`n bold ${(p.balance ?? 0) < 0 ? 'green' : ''}`}>{formatMoney(Math.abs(p.balance ?? 0))}<small className="party-balance-caption">{(p.balance ?? 0) < 0 ? kind === 'customer' ? 'لصالح العميل' : 'لصالحنا' : (p.balance ?? 0) > 0 ? L.bal : 'مسوّى'}</small></td>
                  <td data-label="آخر تعامل" className="num muted">{activity.get(p.id) ?? '—'}</td>
                  <td data-label="الحالة"><ActiveBadge active={p.active !== false} /></td>
                  <td data-label="" className="lp-act-cell">
                    <RowActions
                      openLabel="كشف الحساب"
                      onOpen={() => nav(`/parties/${kind}/${p.id}`)}
                      onEdit={can('parties.edit') ? () => setEditing(p) : undefined}
                    >
                      <SyncBadge sync={p._sync} error={p._error} />
                      {p.active !== false && can('treasury.create') && <button className="btn sm party-inline-action" title={kind === 'customer' ? 'قبض من هذا العميل' : 'صرف لهذا المورد'} onClick={(e) => { e.stopPropagation(); nav(`/docs/new/${kind === 'customer' ? 'receipt' : 'payment'}?party=${encodeURIComponent(p.id)}`); }}>{kind === 'customer' ? <ArrowDownLeft /> : <ArrowUpRight />}{kind === 'customer' ? 'قبض' : 'صرف'}</button>}
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <PartyEditor kind={kind} party={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function PartyEditor({ kind, party, onClose, onSaved }: { kind: 'customer' | 'supplier'; party: any | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const ui = useUi();
  const can = usePerm();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const L = KIND_LABEL[kind];
  const [f, setF] = useState<any>(() => ({
    code: party?.code ?? '',
    name: party?.name ?? '',
    phone: party?.phone ?? '',
    address: party?.address ?? '',
    tax_no: party?.tax_no ?? '',
    credit_limit: party?.credit_limit ?? 0,
    price_list: party?.price_list ?? 'retail',
    price_list_id: party?.price_list_id ?? 'pl-retail',
    group_id: party?.group_id ?? null,
    custom: customOf(party),
    discount_pct: party?.discount_bp ? String(party.discount_bp / 100) : '0',
    due_days: party?.due_days ?? 0,
    review_date: party?.review_date ?? '',
    notes: party?.notes ?? '',
    active: party?.active ?? true,
  }));
  const priceLists = useLiveQuery(async () => (await db.price_lists.orderBy('sort').toArray()).filter((p) => p.active !== false), []) ?? [];
  const groups = useLiveQuery(async () => (await db.party_groups.where('kind').equals(kind).toArray()).filter((g) => g.active !== false || g.id === party?.group_id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), [kind]) ?? [];
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    if (saving.current) return;
    if (!can(party ? 'parties.edit' : 'parties.create')) return setErr('لا تملك صلاحية حفظ هذه البيانات');
    saving.current = true;
    setBusy(true);
    try {
    setErr(null);
    let code = f.code.trim();
    if (!code) {
      const all = await db.parties.where('kind').equals(kind).toArray();
      const nums = all.map((p) => Number(p.code)).filter((n) => Number.isInteger(n));
      code = String((nums.length ? Math.max(...nums) : 0) + 1);
    }
    if (!f.name.trim()) return setErr('الاسم مطلوب');
    const dup = (await db.parties.where('kind').equals(kind).toArray()).find((p) => p.code === code && p.id !== party?.id);
    if (dup) return setErr('الكود مستخدم');
    const id = party?.id ?? uuid();
    const discount_bp = Math.round(Number(String(f.discount_pct).replace(',', '.')) * 100);
    if (!Number.isFinite(discount_bp) || discount_bp < 0 || discount_bp > 10000) return setErr('نسبة الخصم غير صالحة');
    const { discount_pct, ...rest } = f;
    void discount_pct;
    await saveMaster(
      'party',
      id,
      { ...rest, kind, code, name: f.name.trim(), phone: f.phone || null, address: f.address || null, tax_no: f.tax_no || null, discount_bp, review_date: f.review_date || null, price_list: f.price_list_id === 'pl-wholesale' ? 'wholesale' : 'retail' },
      party,
    );
    ui.toast('تم الحفظ');
    onSaved?.(id);
    onClose();
    } catch (e) { setErr((e as Error).message || 'تعذر الحفظ. حاول مرة أخرى.'); }
    finally { saving.current = false; setBusy(false); }
  };

  return (
    <Sheet
      title={party ? `تعديل ${L.one}` : `${L.one} جديد`}
      onClose={() => { if (!saving.current) onClose(); }}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ البيانات'}</button>
        </>
      }
    >
      <div className="stack party-editor">
        {err && <Banner kind="err">{err}</Banner>}
        <div className="grid grid-2">
          <Field label={`اسم ال${L.one}`} required error={err === 'الاسم مطلوب' ? err : undefined}>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="الكود" hint="يُولّد تلقائيًا إذا تُرك فارغًا">
            <input className="input num" value={f.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label="الهاتف">
            <input className="input num" value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
        </div>
        <Field label="العنوان">
          <input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        {kind === 'customer' && <Field label="نوع العميل"><select className="select" value={f.group_id ?? ''} onChange={(e) => set('group_id', e.target.value || null)}><option value="">بدون تصنيف</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
        <details className="party-editor-options"><summary>البيانات المالية والضريبية <span>الحد الائتماني والأسعار وشروط السداد</span></summary>
          <Field label="الرقم الضريبي"><input className="input num" value={f.tax_no} onChange={(e) => set('tax_no', e.target.value)} /></Field>
          {kind === 'customer' && (
          <div className="grid grid-2">
            <Field label="الحد الائتماني" hint="0 = بدون حد">
              <MoneyInput value={f.credit_limit} onChange={(v) => set('credit_limit', v)} />
            </Field>
            <Field label="قائمة الأسعار">
              <select className="select" value={f.price_list_id ?? ''} onChange={(e) => set('price_list_id', e.target.value)}>
                {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="نسبة خصم افتراضية %"><input className="input num" inputMode="decimal" value={f.discount_pct} onChange={(e) => set('discount_pct', e.target.value)} /></Field>
            <Field label="تاريخ مراجعة الحساب" hint="للتذكير بمراجعة/تحصيل الحساب"><DateInput className="input" value={f.review_date ?? ''} onChange={(e) => set('review_date', e.target.value)} /></Field>
          </div>
        )}
        <Field label="أيام الاستحقاق للفواتير الآجلة" hint="0 = حسب الإعدادات العامة">
          <input className="input num" type="number" min={0} value={f.due_days} onChange={(e) => set('due_days', Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        </details>
        <details className="party-editor-options"><summary>الخانات الإضافية والملاحظات <span>بياناتك المخصصة وملاحظات الحساب</span></summary>
        <div className="grid grid-2"><PartyFieldInputs kind={kind} value={f.custom} onChange={(v) => set('custom', v)} /></div>
        <Field label="ملاحظات">
          <textarea className="textarea" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        </details>
        <div className="row">
          <Switch checked={f.active} onChange={(v) => set('active', v)} /> {f.active ? 'نشط' : 'موقوف'}
        </div>
      </div>
    </Sheet>
  );
}

export function PartyDetail() {
  const { kind = 'customer', id = '' } = useParams() as { kind: 'customer' | 'supplier'; id: string };
  const can = usePerm();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<'statement' | 'documents' | 'insights'>('statement');
  const [documentQuery, setDocumentQuery] = useState('');
  const [documentPage, setDocumentPage] = useState(0);
  const [range, setRange] = useState({ from: `${todayISO().slice(0, 4)}-01-01`, to: todayISO() });
  const L = KIND_LABEL[kind];
  const party = useLiveQuery(async () => (await db.parties.get(id)) ?? null, [id]);
  const allowedTypes = Object.entries(DOC_TYPES).filter(([, info]) => can(`${info.module}.view`)).map(([type]) => type);
  const docs = useLiveQuery(async () => {
    if (!allowedTypes.length) return [];
    return (await db.documents.where('doc_type').anyOf(allowedTypes).toArray()).filter((d) => d.party_id === id).sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? '')));
  }, [id, allowedTypes.join(',')]) ?? [];
  const [byItems, setByItems] = useState(false);
  const st = useRemote<any>(party && !party._sync && tab === 'statement' ? `/api/reports/party/${id}?from=${range.from}&to=${range.to}${byItems ? '&items=1' : ''}` : null, [party?.row_version]);
  if (party === undefined) return <div className="page muted">جارٍ تحميل بيانات الحساب…</div>;
  if (!party || party.kind !== kind) return <div className="page"><Empty title="الحساب غير موجود" /></div>;
  const posted = docs.filter((d) => d.status === 'posted');
  const last = posted[0];
  const openInvoices = posted.filter((d) => d.doc_type === (kind === 'customer' ? 'sale_invoice' : 'purchase_invoice') && !d.closed && d.total > d.paid);
  const filteredDocs = docs.filter((d) => d.date >= range.from && d.date <= range.to && (!documentQuery.trim() || [d.number, d.local_number, d.notes, DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label].some((s) => s?.includes(documentQuery.trim()))));
  const pageCount = Math.max(1, Math.ceil(filteredDocs.length / 20));
  const safePage = Math.min(documentPage, pageCount - 1);
  const balanceLabel = (party.balance ?? 0) < 0 ? kind === 'customer' ? 'رصيد لصالح العميل' : 'رصيد لنا عند المورد' : kind === 'customer' ? 'مستحق لنا من العميل' : 'مستحق علينا للمورد';
  const statement = !st.loading && !st.error && !party._sync ? st.data : null;

  return (
    <div className="page party-detail-page">
      <PageHeader
        title={party.name}
        sub={<>{L.one} · كود <span className="num">{party.code}</span>{party.phone ? <> · <span className="num">{party.phone}</span></> : null} <SyncBadge sync={party._sync} error={party._error} /></>}
        actions={
          <>
            {can('parties.edit') && <button className="btn" onClick={() => setEdit(true)}><Pencil /> تعديل</button>}
            {can('treasury.create') && (
              <button className="btn" disabled={party.active === false} onClick={() => nav(`/docs/new/${kind === 'customer' ? 'receipt' : 'payment'}?party=${id}`)}>
                {kind === 'customer' ? <ArrowDownLeft /> : <ArrowUpRight />}{kind === 'customer' ? 'قبض من العميل' : 'صرف للمورد'}
              </button>
            )}
            {can(kind === 'customer' ? 'sales.create' : 'purchases.create') && (
              <button className="btn primary" disabled={party.active === false} onClick={() => nav(`/docs/new/${kind === 'customer' ? 'sale_invoice' : 'purchase_invoice'}?party=${id}`)}>
                {kind === 'customer' ? <ShoppingCart /> : <ShoppingBag />}{kind === 'customer' ? 'فاتورة بيع' : 'فاتورة شراء'}
              </button>
            )}
          </>
        }
      />
      <div className="card party-profile-strip"><span className="party-profile-avatar">{party.name.slice(0, 1)}</span><div><strong>{party.name}</strong><div className="muted">{party.phone && <span><Phone /> <span className="num">{party.phone}</span></span>}{party.address && <span><MapPin /> {party.address}</span>}{!party.phone && !party.address && <span>أضف بيانات التواصل من تعديل الحساب</span>}</div></div><ActiveBadge active={party.active !== false} /></div>
      <div className="party-detail-stats">
        <div className="card stat">
          <div className="stat-label">{balanceLabel}</div>
          <div className={`stat-value num ${party.balance < 0 ? 'green' : ''}`}>{formatMoney(Math.abs(party.balance ?? 0))}</div>
          <div className="muted small">الرصيد الحالي المسجل للحساب</div>
        </div>
        <div className="card stat"><div className="stat-label">آخر تعامل مرحّل</div><div className="party-stat-date num">{last?.date ?? 'لا يوجد'}</div><div className="muted small">{last ? `${DOC_TYPES[last.doc_type as keyof typeof DOC_TYPES]?.label} · ${last.number ?? last.local_number ?? ''}` : 'حسب المستندات المتاحة ضمن صلاحياتك'}</div></div>
        {can(kind === 'customer' ? 'sales.view' : 'purchases.view') && <button className="card stat party-stat-button" onClick={() => { setTab('documents'); setDocumentQuery(''); }}><div className="stat-label">متبقي الفواتير المفتوحة</div><div className="stat-value num">{formatMoney(openInvoices.reduce((s, d) => s + d.total - d.paid, 0))}</div><div className="muted small">{openInvoices.length} فاتورة · افتح السجل</div></button>}
        {kind === 'customer' && (
          <div className="card stat">
            <div className="stat-label">الحد الائتماني</div>
            <div className="stat-value num">{party.credit_limit ? formatMoney(party.credit_limit) : 'بدون حد'}</div>
          </div>
        )}
        {can('accounts.journal') && (
          <button className="tile" onClick={() => nav(`/docs/new/party_opening?party=${id}`)}>
            <span className="tt">تسجيل رصيد افتتاحي</span>
            <span className="caption">للأرصدة السابقة قبل بدء استخدام النظام</span>
          </button>
        )}
      </div>

      <div className="party-detail-tabs no-print" role="tablist" aria-label="تفاصيل الحساب">{([{ id: 'statement', label: 'كشف الحساب' }, { id: 'documents', label: 'الفواتير والحركات' }, ...(can(kind === 'customer' ? 'sales.view' : 'purchases.view') ? [{ id: 'insights', label: 'تحليل التعاملات' }] : [])] as const).map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id as typeof tab)}>{item.label}</button>)}</div>
      {tab === 'insights' && can(kind === 'customer' ? 'sales.view' : 'purchases.view') && <PartyInsights party={party} />}
      {tab === 'statement' && <section className="card party-statement-panel">
      <div className="row wrap" style={{ marginTop: 22, marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0, flex: 1 }}>كشف الحساب</div>
        <label className="party-date-label">من<DateInput className="input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="party-date-label">إلى<DateInput className="input" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <Segmented value={byItems ? '1' : '0'} onChange={(v) => setByItems(v === '1')} options={[{ value: '0', label: 'مختصر' }, { value: '1', label: 'بالأصناف' }]} />
        {statement && (
          <button
            className="btn"
            onClick={() =>
              exportExcel(
                `كشف حساب ${party.name}${byItems ? ' بالأصناف' : ''}`,
                ['التاريخ', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'],
                statement.lines.flatMap((l: any) => [
                  [l.date, l.doc_number, l.memo, formatMoney(l.debit), formatMoney(l.credit), formatMoney(l.balance)],
                  ...(l.items ?? []).map((x: any) => ['', '', `   ${x.name} — ${formatQty(x.qty)} ${x.unit_name} × ${formatMoney(x.price)}${x.discount ? ` خصم ${formatMoney(x.discount)}` : ''} = ${formatMoney(x.total)}`, '', '', '']),
                ]),
              )
            }
          >
            تصدير Excel
          </button>
        )}
        <button className="btn no-print" disabled={!statement} onClick={() => savePdf(`كشف حساب ${party.name}`)}>PDF</button>
        <button className="btn no-print" disabled={!statement} onClick={() => window.print()}>طباعة</button>
      </div>
      {party._sync && <Banner kind="info">هذا الطرف لم يُزامن بعد؛ الكشف يظهر بعد قبوله على الخادم.</Banner>}
      {st.loading && <div className="muted" role="status">جارٍ تحميل كشف الحساب…</div>}
      {st.error && <Banner kind="warn">{st.error}</Banner>}
      {statement && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستند</th>
                <th>البيان</th>
                <th className="n">مدين</th>
                <th className="n">دائن</th>
                <th className="n">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="muted">رصيد أول المدة</td>
                <td className="n bold">{formatMoney(statement.opening)}</td>
              </tr>
              {statement.lines.map((l: any, i: number) => (
                <Fragment key={i}>
                <tr className={l.document_id ? 'click' : ''} onClick={() => l.document_id && nav(`/docs/view/${l.document_id}`)}>
                  <td data-label="التاريخ" className="num">{l.date}</td>
                  <td data-label="المستند" className="num">{l.doc_number ?? `قيد ${l.entry_no}`}</td>
                  <td data-label="البيان">{l.memo}</td>
                  <td data-label="مدين" className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
                  <td data-label="دائن" className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
                  <td data-label="الرصيد" className="n bold">{formatMoney(l.balance)}</td>
                </tr>
                {l.items?.length > 0 && (
                  <tr className="st-items">
                    <td colSpan={6}>
                      <table className="st-items-t">
                        <tbody>
                          {l.items.map((x: any) => (
                            <tr key={x.line_no}>
                              <td className="muted num">{x.code}</td>
                              <td>{x.name}</td>
                              <td className="n num">{formatQty(x.qty)} {x.unit_name}</td>
                              <td className="n num">× {formatMoney(x.price)}</td>
                              <td className="n num muted">{x.discount ? `خصم ${formatMoney(x.discount)}` : ''}</td>
                              <td className="n num bold">{formatMoney(x.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الرصيد الختامي</td>
                <td className="n">{formatMoney(statement.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      </section>}
      {tab === 'documents' && <section className="card party-documents-panel">
      <div className="party-documents-toolbar"><h2>الفواتير والحركات</h2><SearchBox value={documentQuery} onChange={(v) => { setDocumentQuery(v); setDocumentPage(0); }} placeholder="رقم المستند أو نوع الحركة أو الملاحظات" /><label className="party-date-label">من<DateInput value={range.from} max={range.to} onChange={(e) => { setRange({ ...range, from: e.target.value }); setDocumentPage(0); }} /></label><label className="party-date-label">إلى<DateInput value={range.to} min={range.from} onChange={(e) => { setRange({ ...range, to: e.target.value }); setDocumentPage(0); }} /></label></div>
      {filteredDocs.length === 0 ? (
        <div className="card pad muted">لا توجد مستندات</div>
      ) : (
        <div className="list">
          {filteredDocs.slice(safePage * 20, safePage * 20 + 20).map((d) => (
            <div key={d.id} className="list-row tappable" onClick={() => nav(`/docs/view/${d.id}`)}>
              <div className="title">
                {DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label} <span className="num muted">{d.number ?? d.local_number}</span>
                <div className="sub num">{d.date}</div>
              </div>
              <DocStatusBadge status={d.status} sync={d._sync} />
              <div className="num">{formatMoney(d.total)}</div>
              {d.paid < d.total && d.status === 'posted' && (d.doc_type === 'sale_invoice' || d.doc_type === 'purchase_invoice') && (
                <span className="badge orange num">متبقي {formatMoney(d.total - d.paid)}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="party-pagination"><span className="muted">{filteredDocs.length} مستند · صفحة {safePage + 1} من {pageCount}</span><button className="btn sm" disabled={!safePage} onClick={() => setDocumentPage(safePage - 1)}>السابق</button><button className="btn sm" disabled={safePage + 1 >= pageCount} onClick={() => setDocumentPage(safePage + 1)}>التالي</button></div>
      </section>}
      {edit && <PartyEditor kind={kind} party={party} onClose={() => setEdit(false)} />}
    </div>
  );
}
