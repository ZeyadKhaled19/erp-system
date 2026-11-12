import { DOC_TYPES, formatMoney, formatQty, hasPermission } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Maximize2, Pencil, Printer, Send, Truck, Undo2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { lookOf, payState } from './Invoices';
import { Banner, DocStatusBadge, Empty, Field, Sheet, useUi } from '../components/ui';
import { DeliverSheet } from './Deliveries';
import { cancelDocument, postDocument } from '../lib/actions';
import { db } from '../lib/db';
import { useRemote, useSession, useSettings } from '../lib/hooks';

export function DocumentView({ id: propId, embedded }: { id?: string; embedded?: boolean } = {}) {
  const { id: paramId = '' } = useParams();
  const id = propId ?? paramId;
  const nav = useNavigate();
  const ui = useUi();
  const { session } = useSession();
  const can = (k: string) => hasPermission(session.user.permissions, k);
  const settings = useSettings();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [tab, setTab] = useState('items');
  useEffect(() => setTab('items'), [id]);

  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const lines = useLiveQuery(() => db.document_lines.where('document_id').equals(id).sortBy('line_no'), [id]) ?? [];
  const lookups = useLiveQuery(async () => {
    if (!doc) return null;
    const [toCb, partner, rep, insts] = await Promise.all([
      doc.to_cashbox_id ? db.cashboxes.get(doc.to_cashbox_id) : undefined,
      doc.partner_id ? db.partners.get(doc.partner_id) : undefined,
      doc.sales_rep_id ? db.sales_reps.get(doc.sales_rep_id) : undefined,
      db.instruments.where('document_id').equals(doc.id).toArray(),
    ]);
    const cbs = new Map((await db.cashboxes.toArray()).map((c) => [c.id, c]));
    const [party, wh, wh2, cb, acc, creator, ref] = await Promise.all([
      doc.party_id ? db.parties.get(doc.party_id) : undefined,
      doc.warehouse_id ? db.warehouses.get(doc.warehouse_id) : undefined,
      doc.to_warehouse_id ? db.warehouses.get(doc.to_warehouse_id) : undefined,
      doc.cashbox_id ? db.cashboxes.get(doc.cashbox_id) : undefined,
      doc.account_id ? db.accounts.get(doc.account_id) : undefined,
      doc.created_by ? db.users.get(doc.created_by) : undefined,
      doc.ref_doc_id ? db.documents.get(doc.ref_doc_id) : undefined,
    ]);
    const items = new Map((await db.items.bulkGet(lines.map((l) => l.item_id))).filter(Boolean).map((i) => [i!.id, i!]));
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
    const parties = new Map((await db.parties.toArray()).map((p) => [p.id, p]));
    return { party, wh, wh2, cb, acc, creator, ref, items, accounts, parties, toCb, partner, rep, insts, cbs };
  }, [doc, lines]);
  useEffect(() => {
    if (embedded || !doc) return;
    const label = DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES]?.label ?? 'مستند';
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = `${label} ${doc.number ?? doc.local_number ?? ''}`;
    document.title = `${label} — الحسابات`;
  }, [embedded, doc?.id, doc?.number]);
  const remote = useRemote<any>(doc && !doc._sync ? `/api/documents/${id}` : null, [doc?.row_version]);

  if (doc === undefined) return <div className="page muted">جارٍ التحميل…</div>;
  if (!doc) return <div className="page"><Empty title="المستند غير موجود على هذا الجهاز" /></div>;
  const info = DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES];
  const L = lookups;
  const module = info.module;
  const canEdit = (doc.status === 'draft' || doc.status === 'pending_review' || doc._sync === 'rejected') && can(module === 'accounts' ? 'accounts.journal' : `${module}.create`);
  const canPost = doc.status === 'draft' && !doc._sync && can(module === 'accounts' ? 'accounts.post' : `${module}.post`);
  const canCancel = doc.status !== 'cancelled' && !(doc._sync === 'pending' && !doc.number) && can(module === 'accounts' ? 'accounts.cancel' : `${module}.cancel`);
  const returnType = doc.doc_type === 'sale_invoice' ? 'sale_return' : doc.doc_type === 'purchase_invoice' ? 'purchase_return' : null;
  const payments: any[] = doc.data?.payments ?? [];
  const shares: any[] = doc.data?.shares ?? [];
  const charges: any[] = doc.data?.charges ?? [];
  const undelivered = doc.deliver_later ? lines.reduce((s, l) => s + (l.base_qty - (l.delivered_qty ?? 0)), 0) : 0;

  const look = lookOf(doc.doc_type);
  const ps = payState(doc);
  const remaining = (doc.total ?? 0) - (doc.paid ?? 0);
  const entries: any[] = remote.data?.entries ?? [];
  const deliveries: any[] = remote.data?.deliveries ?? [];
  const related: any[] = remote.data?.related ?? [];
  const audit: any[] = remote.data?.audit ?? [];
  const tabs: { key: string; label: string; n?: number }[] = [
    ...(lines.length ? [{ key: 'items', label: 'الأصناف', n: lines.length }] : []),
    ...(doc.doc_type === 'journal_voucher' ? [{ key: 'items', label: 'سطور القيد', n: (doc.data?.journal_lines ?? []).length }] : []),
    ...(doc.doc_type === 'profit_distribution' ? [{ key: 'items', label: 'التوزيع', n: shares.length }] : []),
    ...(payments.length || (L?.insts?.length ?? 0) || charges.length ? [{ key: 'pay', label: 'السداد', n: payments.length + (L?.insts?.length ?? 0) }] : []),
    { key: 'details', label: 'التفاصيل' },
    ...(entries.length ? [{ key: 'acc', label: 'القيود المحاسبية', n: entries.length }] : []),
    ...(deliveries.length ? [{ key: 'deliv', label: 'التسليمات', n: deliveries.length }] : []),
    ...(related.length ? [{ key: 'rel', label: 'مستندات مرتبطة', n: related.length }] : []),
    ...(audit.length ? [{ key: 'log', label: 'السجل', n: audit.length }] : []),
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  const partyLabel = L?.party ? (L.party.id === 'party-cash-customer' ? 'عميل نقدي' : L.party.name) : null;

  return (
    <div className={embedded ? 'dv dv-embedded' : 'page dv'}>
      {/* الرأس: أهم المعلومات فقط */}
      <div className="card dv-hero">
        <div className="dv-hero-top">
          <span className={`inv-ic lg t-${look.tone}`}>{look.icon}</span>
          <div className="dv-hero-t">
            <div className="dv-type">
              <span>{info.label}</span>
              <span className="num dv-no">{doc.number ?? doc.local_number}</span>
              <DocStatusBadge status={doc.status} sync={doc._sync} />
              {ps && <span className={`inv-pay ${ps.key}`}>{ps.label}</span>}
            </div>
            {partyLabel && (
              <div className="dv-party">
                {L?.party && L.party.id !== 'party-cash-customer' ? (
                  <a onClick={() => nav(`/parties/${L.party!.kind}/${L.party!.id}`)}>{partyLabel}</a>
                ) : (
                  partyLabel
                )}
                {L?.party?.phone && <span className="num dv-phone">{L.party.phone}</span>}
              </div>
            )}
            <div className="dv-meta">
              <span className="num">{doc.date}</span>
              {doc.created_at && <span className="num">{new Date(doc.created_at).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })}</span>}
              {L?.creator && <span>{L.creator.full_name}</span>}
              {!doc.number && <span className="caption">الرقم الرسمي يصدر عند قبول الخادم</span>}
            </div>
          </div>
        </div>

        <div className="dv-money">
          <div className="dv-m">
            <span>الإجمالي</span>
            <b className="num">{formatMoney(doc.total)}</b>
          </div>
          {info.priced && doc.doc_type !== 'quotation' && (
            <>
              <div className="dv-m">
                <span>{doc.doc_type.endsWith('return') ? 'المردود نقدًا' : 'المدفوع'}</span>
                <b className="num green">{formatMoney(doc.paid)}</b>
              </div>
              <div className="dv-m">
                <span>المتبقي</span>
                <b className={`num ${remaining > 0 ? 'red' : ''}`}>{formatMoney(remaining)}</b>
              </div>
            </>
          )}
          {can('reports.profit') && doc.status === 'posted' && !doc._sync && doc.cost != null && doc.doc_type === 'sale_invoice' && (
            <div className="dv-m no-print">
              <span>مجمل الربح</span>
              <b className="num green">{formatMoney(doc.total - doc.tax - doc.cost)}</b>
            </div>
          )}
        </div>
        {ps && ps.key !== 'paid' && <div className="inv-progress lg"><i style={{ width: `${ps.pct}%` }} /></div>}

        <div className="dv-actions no-print">
          {canEdit && <button className="btn" onClick={() => nav(`/docs/edit/${doc.id}`)}><Pencil /> تعديل</button>}
          {canPost && (
            <button
              className="btn primary"
              onClick={async () => {
                if (await ui.confirm({ title: `ترحيل ${info.label}؟`, message: 'سيتم تطبيق أثر المستند على المخزون والحسابات. لا يمكن التعديل بعدها.', confirmLabel: 'ترحيل' })) {
                  await postDocument(doc);
                  ui.toast('سيُرحّل عند المزامنة');
                }
              }}
            >
              <Send /> ترحيل
            </button>
          )}
          {doc.doc_type === 'quotation' && doc.status === 'posted' && !doc.converted_to_id && !doc._sync && can('sales.create') && (
            <button className="btn primary" onClick={() => nav(`/docs/new/sale_invoice?quotation=${doc.id}`)}><Send /> تحويل لفاتورة بيع</button>
          )}
          {doc.doc_type === 'quotation' && doc.converted_to_id && <button className="btn" onClick={() => nav(`/docs/view/${doc.converted_to_id}`)}>الفاتورة الناتجة</button>}
          {['sale_invoice', 'purchase_invoice'].includes(doc.doc_type) && doc.status === 'posted' && remaining > 0 && !doc.closed && can('treasury.create') && doc.party_id && doc.party_id !== 'party-cash-customer' && (
            <button className="btn primary" onClick={() => nav(`/docs/new/${doc.doc_type === 'sale_invoice' ? 'receipt' : 'payment'}?party=${doc.party_id}&ref=${doc.id}&amount=${remaining}`)}>
              <Wallet /> {doc.doc_type === 'sale_invoice' ? 'تحصيل المتبقي' : 'سداد المتبقي'}
            </button>
          )}
          {doc.deliver_later && doc.status === 'posted' && undelivered > 0 && !doc._sync && can('sales.deliver') && (
            <button className="btn primary" onClick={() => setDeliverOpen(true)}><Truck /> تسليم</button>
          )}
          <button className="btn" onClick={() => nav(`/print/${doc.id}`)}><Printer /> طباعة</button>
          {returnType && doc.status === 'posted' && !doc._sync && can(`${module}.create`) && (
            <button className="btn" onClick={() => nav(`/docs/new/${returnType}?party=${doc.party_id}&ref=${doc.id}`)}><Undo2 /> مرتجع</button>
          )}
          {embedded && <button className="btn plain" onClick={() => nav(`/docs/view/${doc.id}`)}><Maximize2 /> فتح كامل</button>}
          {canCancel && <button className="btn plain danger" onClick={() => setCancelOpen(true)}><Ban /> إلغاء</button>}
        </div>
      </div>

      {doc._sync === 'pending' && <div className="no-print dv-banner"><Banner kind="info">هذا المستند محفوظ على الجهاز وبانتظار المزامنة. لم يُرحّل مركزيًا بعد.</Banner></div>}
      {doc._sync === 'rejected' && <div className="no-print dv-banner"><Banner kind="err">رفض الخادم هذا المستند: {doc._error}. عدّله ثم احفظه مرة أخرى، أو تجاهله من مركز المزامنة.</Banner></div>}
      {(doc.status === 'pending_review' || doc._sync === 'conflict') && (
        <div className="no-print dv-banner"><Banner kind="warn">{doc.review_reason ?? doc._error} — يمكن لمستخدم لديه صلاحية حل التعارضات معالجته من مركز المزامنة.</Banner></div>
      )}
      {doc.status === 'cancelled' && <div className="dv-banner"><Banner kind="err">ملغي{doc.cancel_reason ? `: ${doc.cancel_reason}` : ''}. أُبقي الأصل وعُكس أثره بقيد عكسي.</Banner></div>}

      {/* رأس الطباعة */}
      <div className="print-only" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{settings.company_name}</div>
            {settings.company_address && <div>{settings.company_address}</div>}
            {settings.company_phone && <div>{settings.company_phone}</div>}
            {settings.company_tax_no && <div>رقم التسجيل الضريبي: {settings.company_tax_no}</div>}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{info.label}</div>
            <div>رقم: {doc.number ?? doc.local_number}</div>
            <div>التاريخ: {doc.date}</div>
          </div>
        </div>
      </div>

      {/* التبويبات */}
      <div className="dv-tabs no-print" role="tablist" aria-label="أقسام المستند">
        {tabs.map((t) => (
          <button key={t.key + t.label} role="tab" aria-selected={active === t.key} className={active === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.n ? <span className="num">{t.n}</span> : null}
          </button>
        ))}
      </div>

      {active === 'items' && lines.length > 0 && (
        <div className="card dv-panel">
          <div className="dv-table">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الصنف</th>
                  <th>الوحدة</th>
                  <th className="n">{doc.doc_type === 'stock_adjustment' ? 'الكمية الفعلية' : 'الكمية'}</th>
                  {doc.deliver_later && <th className="n">المسلّم</th>}
                  {doc.doc_type === 'stock_adjustment' && <th className="n">رصيد النظام</th>}
                  {(info.priced || doc.doc_type === 'opening_stock') && <th className="n">السعر</th>}
                  {info.priced && <th className="n">الخصم</th>}
                  {info.priced && <th className="n">الضريبة</th>}
                  {(info.priced || doc.doc_type === 'opening_stock') && <th className="n">الإجمالي</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="#" className="num muted">{l.line_no}</td>
                    <td data-label="الصنف" className="bold">{L?.items.get(l.item_id)?.name ?? '…'}</td>
                    <td data-label="الوحدة">{l.unit_name}</td>
                    <td data-label="الكمية" className="n">{formatQty(l.qty)}</td>
                    {doc.deliver_later && <td data-label="المسلّم" className="n">{formatQty(Math.round(((l.delivered_qty ?? 0) * 1000) / l.unit_factor))}</td>}
                    {doc.doc_type === 'stock_adjustment' && <td data-label="رصيد النظام" className="n">{l.system_qty != null ? formatQty(l.system_qty) : '—'}</td>}
                    {(info.priced || doc.doc_type === 'opening_stock') && <td data-label="السعر" className="n">{formatMoney(l.price)}</td>}
                    {info.priced && <td data-label="الخصم" className="n">{formatMoney((l.discount ?? 0) + (l.doc_discount ?? 0))}</td>}
                    {info.priced && <td data-label="الضريبة" className="n">{formatMoney(l.tax ?? 0)}</td>}
                    {(info.priced || doc.doc_type === 'opening_stock') && <td data-label="الإجمالي" className="n bold">{formatMoney(l.total ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {info.priced && (
            <div className="dv-sum">
              <div><span>الإجمالي قبل الخصم</span><b className="num">{formatMoney(doc.gross)}</b></div>
              <div><span>الخصومات</span><b className="num">{formatMoney(doc.discount)}</b></div>
              <div><span>الضريبة</span><b className="num">{formatMoney(doc.tax)}</b></div>
              <div className="grand"><span>الإجمالي</span><b className="num">{formatMoney(doc.total)}</b></div>
            </div>
          )}
        </div>
      )}

      {active === 'items' && doc.doc_type === 'journal_voucher' && (
        <div className="card dv-panel">
          <div className="dv-table">
            <table className="table responsive">
              <thead><tr><th>الحساب</th><th>الطرف</th><th className="n">مدين</th><th className="n">دائن</th><th>البيان</th></tr></thead>
              <tbody>
                {(doc.data?.journal_lines ?? []).map((l: any, i: number) => (
                  <tr key={i}>
                    <td data-label="الحساب">{L?.accounts.get(l.account_id)?.name}</td>
                    <td data-label="الطرف">{l.party_id ? L?.parties.get(l.party_id)?.name : ''}</td>
                    <td data-label="مدين" className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
                    <td data-label="دائن" className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
                    <td data-label="البيان">{l.memo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'items' && doc.doc_type === 'profit_distribution' && (
        <div className="card pad dv-panel">
          <div className="grid grid-4">
            <Info k="الفترة" v={<span className="num">{doc.data?.period_from} ← {doc.data?.period_to}</span>} />
            <Info k="صافي الربح المرحّل" v={doc.data?.net_profit != null ? formatMoney(doc.data.net_profit) : 'يُحسب عند المزامنة'} />
            <Info k="المحتجز" v={doc.data?.retained != null ? `${formatMoney(doc.data.retained)} (${(doc.data.retained_bp ?? 0) / 100}%)` : '—'} />
            <Info k="القابل للتوزيع" v={formatMoney(doc.total)} />
          </div>
          {shares.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead><tr><th>الشريك</th><th className="n">نسبة الملكية</th><th className="n">نسبة الأرباح</th><th className="n">النصيب</th></tr></thead>
                <tbody>
                  {shares.map((sh) => (
                    <tr key={sh.partner_id}><td>{sh.name}</td><td className="n">{(sh.ownership_bp ?? 0) / 100}%</td><td className="n">{sh.profit_bp / 100}%</td><td className="n bold">{formatMoney(sh.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {doc.status === 'draft' && <div className="footnote" style={{ marginTop: 8 }}>مسودة للمراجعة. الاعتماد بزر «ترحيل» ويحتاج صلاحية اعتماد توزيع الأرباح؛ يُعاد التحقق من صافي الربح عند الاعتماد.</div>}
        </div>
      )}

      {active === 'pay' && (
        <div className="dv-grid">
          {payments.length > 0 && (
            <div className="card dv-panel dv-box">
              <div className="dv-box-h">{doc.doc_type.endsWith('return') ? 'رد النقدية' : 'طرق الدفع'}</div>
              {payments.map((p) => (
                <div key={p.id} className="dv-row"><span>{L?.cbs.get(p.cashbox_id)?.name}</span><b className="num">{formatMoney(p.amount)}</b></div>
              ))}
            </div>
          )}
          {(L?.insts?.length ?? 0) > 0 && (
            <div className="card dv-panel dv-box">
              <div className="dv-box-h">الشيكات والأقساط</div>
              {L!.insts.map((x: any) => (
                <div key={x.id} className="dv-row">
                  <span>{x.kind === 'cheque' ? `شيك ${x.cheque_no ?? ''}` : 'قسط'} <span className="num muted">{x.due_date}</span></span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`badge ${x.status === 'collected' ? 'green' : x.status === 'bounced' ? 'red' : x.status === 'open' ? 'orange' : ''}`}>{{ open: 'مفتوح', collected: 'محصل', bounced: 'مرتد', closed: 'مغلق', cancelled: 'ملغي' }[x.status as string]}</span>
                    <b className="num">{formatMoney(x.amount)}</b>
                  </span>
                </div>
              ))}
            </div>
          )}
          {charges.length > 0 && (
            <div className="card dv-panel dv-box">
              <div className="dv-box-h">{doc.doc_type === 'purchase_invoice' ? 'مصروفات محمّلة على التكلفة' : 'إضافات ومصروفات'}</div>
              {charges.map((c) => (
                <div key={c.id} className="dv-row">
                  <span>{c.name} <span className="badge">{c.mode === 'add' ? 'إضافة على الفاتورة' : `مصروف من ${L?.cbs.get(c.cashbox_id)?.name ?? 'الخزينة'}`}</span></span>
                  <b className="num">{formatMoney(c.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active === 'details' && (
        <div className="card pad dv-panel">
          <div className="dv-info">
            <Info k="التاريخ" v={<span className="num">{doc.date}</span>} />
            {L?.party && <Info k={L.party.kind === 'customer' ? 'العميل' : 'المورد'} v={partyLabel} />}
            {L?.party && L.party.id !== 'party-cash-customer' && <Info k="رصيد الطرف الحالي" v={<span className="num">{formatMoney(L.party.balance ?? 0)}</span>} />}
            {L?.wh && <Info k={doc.to_warehouse_id ? 'من مخزن' : 'المخزن'} v={L.wh.name} />}
            {L?.wh2 && <Info k="إلى مخزن" v={L.wh2.name} />}
            {L?.cb && <Info k="الخزينة" v={L.cb.name} />}
            {L?.acc && <Info k="الحساب" v={L.acc.name} />}
            {info.priced && <Info k="طريقة الدفع" v={doc.payment_type === 'cash' ? 'نقدي' : 'آجل'} />}
            {L?.ref && <Info k="المستند المرجعي" v={<a style={{ cursor: 'pointer' }} onClick={() => nav(`/docs/view/${L.ref!.id}`)}>{L.ref.number}</a>} />}
            {L?.toCb && <Info k="إلى خزينة" v={L.toCb.name} />}
            {L?.partner && <Info k="الشريك" v={L.partner.name} />}
            {L?.rep && <Info k="المندوب" v={L.rep.name} />}
            {doc.due_date && <Info k="تاريخ الاستحقاق" v={<span className="num">{doc.due_date}</span>} />}
            {doc.doc_type === 'quotation' && <Info k="حجز البضاعة" v={doc.reserve ? (doc.converted_to_id ? 'انتهى (حُوّل لفاتورة)' : 'محجوزة') : 'بدون حجز'} />}
            {doc.closed && <Info k="المتابعة" v="مغلقة" />}
            {doc.deliver_later && <Info k="التسليم" v={undelivered > 0 ? <span className="orange bold">متبقي {formatQty(undelivered)}</span> : <span className="green bold">مسلّمة بالكامل</span>} />}
            {doc.order_status && <Info k="حالة الطلب" v={doc.order_status} />}
            {doc.shipping_company && <Info k="شركة الشحن" v={doc.shipping_company} />}
            {L?.creator && <Info k="أنشأه" v={L.creator.full_name} />}
          </div>
          <div className="dv-notes">
            <div className="info-k">ملاحظات</div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{doc.notes || '—'}</div>
          </div>
        </div>
      )}

      {active === 'acc' && (
        <div className="dv-stack no-print">
          {entries.map((e: any) => (
            <div key={e.id} className="card dv-panel">
              <div className="dv-box-h dv-entry-h">قيد رقم <span className="num">{e.number}</span> · <span className="num">{e.date}</span> {e.reverses_id && <span className="badge red">قيد عكسي</span>}</div>
              <div className="dv-table">
                <table className="table">
                  <thead><tr><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th><th>البيان</th></tr></thead>
                  <tbody>
                    {e.lines.map((l: any) => (
                      <tr key={l.id}>
                        <td>{l.account_code} — {l.account_name}{l.party_name ? ` / ${l.party_name}` : ''}</td>
                        <td className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
                        <td className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
                        <td className="muted small">{l.memo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {active === 'deliv' && (
        <div className="list no-print">
          {deliveries.map((d: any) => (
            <div key={d.id} className="list-row">
              <div className="title">
                <span className="num">{d.date}</span> — {d.user_name}
                <div className="sub">
                  {d.lines.map((x: any) => {
                    const ln = lines.find((l) => l.id === x.line_id);
                    return `${L?.items.get(ln?.item_id)?.name ?? ''}: ${formatQty(x.qty)}${x.serials?.length ? ` (${x.serials.join('، ')})` : ''}`;
                  }).join(' · ')}
                  {d.notes ? ` — ${d.notes}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {active === 'rel' && (
        <div className="list no-print">
          {related.map((r: any) => (
            <div key={r.id} className="list-row tappable" onClick={() => nav(`/docs/view/${r.id}`)}>
              <div className="title">{DOC_TYPES[r.doc_type as keyof typeof DOC_TYPES]?.label} <span className="num muted">{r.number}</span></div>
              <DocStatusBadge status={r.status} />
              <span className="num">{formatMoney(r.total)}</span>
            </div>
          ))}
        </div>
      )}

      {active === 'log' && (
        <div className="list no-print">
          {audit.map((a: any, i: number) => (
            <div key={i} className="list-row">
              <div className="title">
                {a.action === 'doc.save' ? (a.details?.action === 'post' ? 'حفظ وترحيل' : 'حفظ مسودة') : a.action === 'doc.post' ? 'ترحيل' : a.action === 'doc.cancel' ? 'إلغاء' : a.action === 'conflict.resolve' ? 'حل تعارض' : a.action}
                <div className="sub">{a.user_name} · جهاز <span className="num">{String(a.device_id ?? '').slice(0, 8)}</span> · أُنشئ على الجهاز {a.client_created_at ? new Date(a.client_created_at).toLocaleString('ar-EG') : '—'}</div>
              </div>
              <span className={`badge ${a.sync_status === 'accepted' ? 'green' : a.sync_status === 'rejected' ? 'red' : 'orange'}`}>
                {a.sync_status === 'accepted' ? 'مقبول' : a.sync_status === 'rejected' ? 'مرفوض' : 'تعارض'}
              </span>
              <span className="caption num">{new Date(a.at).toLocaleString('ar-EG')}</span>
            </div>
          ))}
        </div>
      )}
      {settings.invoice_footer && <div className="print-only" style={{ marginTop: 20, textAlign: 'center' }}>{settings.invoice_footer}</div>}

      {deliverOpen && <DeliverSheet doc={doc} onClose={() => setDeliverOpen(false)} />}
      {cancelOpen && (
        <Sheet
          title={`إلغاء ${info.label}`}
          onClose={() => setCancelOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCancelOpen(false)}>رجوع</button>
              <button
                className="btn danger primary"
                disabled={reason.trim().length < 3}
                onClick={async () => {
                  await cancelDocument(doc, reason.trim());
                  setCancelOpen(false);
                  ui.toast('سيُلغى عند المزامنة');
                }}
              >
                تأكيد الإلغاء
              </button>
            </>
          }
        >
          <div className="stack">
            <Banner kind="warn">
              {doc.status === 'posted'
                ? 'سيُعكس أثر المستند بالكامل (المخزون والقيود والأرصدة) بقيد عكسي، مع الاحتفاظ بالمستند الأصلي في السجل.'
                : 'سيُلغى المستند دون أي أثر محاسبي.'}
            </Banner>
            <Field label="سبب الإلغاء *">
              <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="info-k">{k}</div>
      <div className="info-v">{v}</div>
    </div>
  );
}
