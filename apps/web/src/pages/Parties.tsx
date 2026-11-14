import { DOC_TYPES, formatMoney, formatQty, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Users, Wallet, UserCheck, FileClock } from 'lucide-react';
import { QuickActions, SectionStats } from '../components/Section';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, DocStatusBadge, Empty, exportExcel, savePdf, Field, MoneyInput, SearchBox, Segmented, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { PartyInsights } from '../components/Insights';
import { PartyGroupSheet } from '../components/CustomerFields';
import { ActiveBadge, PageTabs, RowActions } from '../components/ListParts';
import { db } from '../lib/db';
import { useDebounced, usePerm, useRemote } from '../lib/hooks';

const KIND_LABEL = { customer: { one: 'عميل', many: 'العملاء', bal: 'مستحق عليه' }, supplier: { one: 'مورد', many: 'الموردون', bal: 'مستحق له' } } as const;

export function PartiesPage() {
  const { kind = 'customer' } = useParams() as { kind: 'customer' | 'supplier' };
  const can = usePerm();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'balance'>('all');
  const [grp, setGrp] = useState('');
  const [grpSheet, setGrpSheet] = useState<any | undefined>(undefined);
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
    return parties.filter((p) => (!grp || p.group_id === grp) && (!s || [p.name, p.code, p.phone].some((v) => v?.toLowerCase().includes(s))) && (filter === 'all' || p.balance !== 0));
  }, [parties, dq, filter, grp]);
  const total = list.reduce((s, p) => s + (p.balance ?? 0), 0);
  // مؤشرات القسم من كل العملاء/الموردين (مش من نتيجة البحث)
  const activeParties = parties.filter((p) => p.active !== false);
  const withBal = parties.filter((p) => (p.balance ?? 0) !== 0);
  const allBal = parties.reduce((s, p) => s + (p.balance ?? 0), 0);
  const openDocs = useLiveQuery(async () => {
    const t = kind === 'customer' ? 'sale_invoice' : 'purchase_invoice';
    return (await db.documents.where('doc_type').equals(t).toArray()).filter((d) => d.status === 'posted' && !d.closed && d.total > d.paid).length;
  }, [kind]) ?? 0;

  return (
    <div className="page">
      <PageTabs tabs={[{ to: '/parties/customer', label: 'العملاء' }, { to: '/parties/supplier', label: 'الموردون' }]} />
      <PageHeader
        title={L.many}
        sub={`${list.length} · إجمالي ${L.bal}: ${formatMoney(total)}`}
        actions={
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
          { key: 'bal', label: kind === 'customer' ? 'مستحقات العملاء' : 'مستحقات الموردين', value: formatMoney(allBal), icon: <Wallet />, color: kind === 'customer' ? 'orange' : 'purple', valueTone: allBal < 0 ? 'red' : undefined },
          { key: 'withbal', label: 'لهم رصيد', value: withBal.length, icon: <UserCheck />, color: 'teal' },
          { key: 'open', label: kind === 'customer' ? 'فواتير بيع آجلة' : 'فواتير شراء آجلة', value: openDocs, sub: 'غير مسددة بالكامل', icon: <FileClock />, color: 'red', to: kind === 'customer' ? '/receivables' : undefined },
        ]} />
        <QuickActions section={`parties-${kind}`} defaults={kind === 'customer' ? ['customer_new', 'receipt', 'sale_invoice', 'quotation'] : ['supplier_new', 'payment', 'purchase_invoice', 'purchase_return']} />
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو الكود أو الهاتف" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'الكل' }, { value: 'balance', label: 'لهم رصيد' }]} />
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
      {grpSheet !== undefined && <PartyGroupSheet group={grpSheet} onClose={() => setGrpSheet(undefined)} onSaved={(id) => setGrp(id)} />}
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
                <th className="n">{L.bal}</th>
                <th>الحالة</th>
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
                  <td data-label={L.bal} className={`n bold ${(p.balance ?? 0) < 0 ? 'red' : ''}`}>{formatMoney(p.balance ?? 0)}</td>
                  <td data-label="الحالة"><ActiveBadge active={p.active !== false} /></td>
                  <td data-label="" className="lp-act-cell">
                    <RowActions
                      openLabel="كشف الحساب"
                      onOpen={() => nav(`/parties/${kind}/${p.id}`)}
                      onEdit={can('parties.edit') ? () => setEditing(p) : undefined}
                    >
                      <SyncBadge sync={p._sync} error={p._error} />
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
  };

  return (
    <Sheet
      title={party ? `تعديل ${L.one}` : `${L.one} جديد`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={save}>حفظ</button>
        </>
      }
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <div className="grid grid-2">
          <Field label="الاسم *">
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="الكود" hint="يُولّد تلقائيًا إذا تُرك فارغًا">
            <input className="input num" value={f.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label="الهاتف">
            <input className="input num" value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="الرقم الضريبي">
            <input className="input num" value={f.tax_no} onChange={(e) => set('tax_no', e.target.value)} />
          </Field>
        </div>
        <Field label="العنوان">
          <input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        {kind === 'customer' && (
          <div className="grid grid-2">
            <Field label="نوع العميل">
              <select className="select" value={f.group_id ?? ''} onChange={(e) => set('group_id', e.target.value || null)}>
                <option value="">—</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="الحد الائتماني" hint="0 = بدون حد">
              <MoneyInput value={f.credit_limit} onChange={(v) => set('credit_limit', v)} />
            </Field>
            <Field label="قائمة الأسعار">
              <select className="select" value={f.price_list_id ?? ''} onChange={(e) => set('price_list_id', e.target.value)}>
                {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="نسبة خصم افتراضية %"><input className="input num" inputMode="decimal" value={f.discount_pct} onChange={(e) => set('discount_pct', e.target.value)} /></Field>
            <Field label="تاريخ مراجعة الحساب" hint="للتذكير بمراجعة/تحصيل الحساب"><input type="date" className="input" value={f.review_date ?? ''} onChange={(e) => set('review_date', e.target.value)} /></Field>
          </div>
        )}
        <Field label="أيام الاستحقاق للفواتير الآجلة" hint="0 = حسب الإعدادات العامة">
          <input className="input num" type="number" min={0} value={f.due_days} onChange={(e) => set('due_days', Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="ملاحظات">
          <textarea className="textarea" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
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
  const [range, setRange] = useState({ from: `${todayISO().slice(0, 4)}-01-01`, to: todayISO() });
  const L = KIND_LABEL[kind];
  const party = useLiveQuery(() => db.parties.get(id), [id]);
  const docs = useLiveQuery(async () => (await db.documents.where('party_id').equals(id).toArray()).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 50), [id]) ?? [];
  const [byItems, setByItems] = useState(false);
  const st = useRemote<any>(party && !party._sync ? `/api/reports/party/${id}?from=${range.from}&to=${range.to}${byItems ? '&items=1' : ''}` : null, [party?.row_version]);
  if (!party) return <div className="page"><Empty title="غير موجود" /></div>;

  return (
    <div className="page">
      <PageHeader
        title={party.name}
        sub={<>{L.one} · كود <span className="num">{party.code}</span>{party.phone ? <> · <span className="num">{party.phone}</span></> : null} <SyncBadge sync={party._sync} error={party._error} /></>}
        actions={
          <>
            {can('parties.edit') && <button className="btn" onClick={() => setEdit(true)}><Pencil /> تعديل</button>}
            {can('treasury.create') && (
              <button className="btn" onClick={() => nav(`/docs/new/${kind === 'customer' ? 'receipt' : 'payment'}?party=${id}`)}>
                {kind === 'customer' ? 'سند قبض' : 'سند صرف'}
              </button>
            )}
            {can(kind === 'customer' ? 'sales.create' : 'purchases.create') && (
              <button className="btn primary" onClick={() => nav(`/docs/new/${kind === 'customer' ? 'sale_invoice' : 'purchase_invoice'}?party=${id}`)}>
                <Plus /> فاتورة
              </button>
            )}
          </>
        }
      />
      <div className="grid grid-3">
        <div className="card stat">
          <div className="stat-label">{L.bal}</div>
          <div className={`stat-value num ${party.balance < 0 ? 'red' : ''}`}>{formatMoney(party.balance ?? 0)}</div>
        </div>
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

      <PartyInsights party={party} />

      <div className="row wrap" style={{ marginTop: 22, marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0, flex: 1 }}>كشف الحساب</div>
        <input type="date" className="input" style={{ width: 160 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input type="date" className="input" style={{ width: 160 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <Segmented value={byItems ? '1' : '0'} onChange={(v) => setByItems(v === '1')} options={[{ value: '0', label: 'مختصر' }, { value: '1', label: 'بالأصناف' }]} />
        {st.data && (
          <button
            className="btn"
            onClick={() =>
              exportExcel(
                `كشف حساب ${party.name}${byItems ? ' بالأصناف' : ''}`,
                ['التاريخ', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'],
                st.data.lines.flatMap((l: any) => [
                  [l.date, l.doc_number, l.memo, formatMoney(l.debit), formatMoney(l.credit), formatMoney(l.balance)],
                  ...(l.items ?? []).map((x: any) => ['', '', `   ${x.name} — ${formatQty(x.qty)} ${x.unit_name} × ${formatMoney(x.price)}${x.discount ? ` خصم ${formatMoney(x.discount)}` : ''} = ${formatMoney(x.total)}`, '', '', '']),
                ]),
              )
            }
          >
            تصدير Excel
          </button>
        )}
        <button className="btn no-print" onClick={() => savePdf(`كشف حساب ${party.name}`)}>PDF</button>
        <button className="btn no-print" onClick={() => window.print()}>طباعة</button>
      </div>
      {party._sync && <Banner kind="info">هذا الطرف لم يُزامن بعد؛ الكشف يظهر بعد قبوله على الخادم.</Banner>}
      {st.error && <Banner kind="warn">{st.error}</Banner>}
      {st.data && (
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
                <td className="n bold">{formatMoney(st.data.opening)}</td>
              </tr>
              {st.data.lines.map((l: any, i: number) => (
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
                <td className="n">{formatMoney(st.data.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="section-title">المستندات</div>
      {docs.length === 0 ? (
        <div className="card pad muted">لا توجد مستندات</div>
      ) : (
        <div className="list">
          {docs.map((d) => (
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
      {edit && <PartyEditor kind={kind} party={party} onClose={() => setEdit(false)} />}
    </div>
  );
}
