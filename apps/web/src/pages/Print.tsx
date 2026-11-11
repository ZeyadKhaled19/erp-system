import { DOC_TYPES, formatMoney, formatQty, tafqeetEGP, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../lib/db';
import { useSettings } from '../lib/hooks';

/**
 * قوالب الطباعة (تعمل دون اتصال من البيانات المحلية):
 * a4 / a5      فاتورة أو مستند كامل
 * thermal80/58 إيصال حراري للكاشير
 * voucher      سند قبض/صرف/مصروف مع التفقيط
 * delivery     إذن تسليم/صرف بضاعة بدون أسعار
 * contract     عقد تقسيط بجدول الأقساط
 */
export type PrintTemplate = 'a4' | 'a5' | 'thermal80' | 'thermal58' | 'voucher' | 'delivery' | 'contract';

export const TEMPLATE_LABEL: Record<PrintTemplate, string> = {
  a4: 'A4 كامل',
  a5: 'A5 نصف صفحة',
  thermal80: 'إيصال حراري 80mm',
  thermal58: 'إيصال حراري 58mm',
  voucher: 'سند (مع المبلغ بالحروف)',
  delivery: 'إذن تسليم بضاعة (بدون أسعار)',
  contract: 'عقد تقسيط',
};

const CASH_DOCS = ['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'partner_capital', 'partner_withdrawal'];

export function templatesFor(doc: any, hasInstallments: boolean): PrintTemplate[] {
  const info = DOC_TYPES[doc.doc_type as DocType];
  if (CASH_DOCS.includes(doc.doc_type)) return ['voucher', 'a5', 'thermal80', 'thermal58'];
  const list: PrintTemplate[] = ['a4', 'a5'];
  if (info?.priced) list.push('thermal80', 'thermal58');
  if (info?.hasLines) list.push('delivery');
  if (doc.doc_type === 'sale_invoice' && hasInstallments) list.push('contract');
  return list;
}

export function defaultTemplate(doc: any, settings: Record<string, any>): PrintTemplate {
  if (CASH_DOCS.includes(doc.doc_type)) return settings.print_template_voucher || 'voucher';
  return settings.print_template_invoice || 'a4';
}

const PAGE_CSS: Record<PrintTemplate, string> = {
  a4: '@page { size: A4; margin: 12mm; }',
  a5: '@page { size: A5; margin: 8mm; }',
  voucher: '@page { size: A5 landscape; margin: 8mm; }',
  delivery: '@page { size: A4; margin: 12mm; }',
  contract: '@page { size: A4; margin: 14mm; }',
  thermal80: '@page { size: 80mm auto; margin: 2mm; }',
  thermal58: '@page { size: 58mm auto; margin: 1.5mm; }',
};

export function PrintPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const data = useLiveQuery(async () => {
    if (!doc) return null;
    const lines = await db.document_lines.where('document_id').equals(id).sortBy('line_no');
    const items = new Map((await db.items.bulkGet(lines.map((l) => l.item_id))).filter(Boolean).map((i) => [i!.id, i!]));
    const party = doc.party_id ? await db.parties.get(doc.party_id) : undefined;
    const wh = doc.warehouse_id ? await db.warehouses.get(doc.warehouse_id) : undefined;
    const wh2 = doc.to_warehouse_id ? await db.warehouses.get(doc.to_warehouse_id) : undefined;
    const cbs = new Map((await db.cashboxes.toArray()).map((c) => [c.id, c]));
    const acc = doc.account_id ? await db.accounts.get(doc.account_id) : undefined;
    const partner = doc.partner_id ? await db.partners.get(doc.partner_id) : undefined;
    const insts = (await db.instruments.where('document_id').equals(id).toArray()).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const user = doc.created_by ? await db.users.get(doc.created_by) : undefined;
    const rep = doc.sales_rep_id ? await db.sales_reps.get(doc.sales_rep_id) : undefined;
    return { lines, items, party, wh, wh2, cbs, acc, partner, insts, user, rep };
  }, [doc, id]);

  const tpl = (sp.get('t') as PrintTemplate) || (doc ? defaultTemplate(doc, settings) : 'a4');
  const auto = sp.get('auto') === '1';

  useEffect(() => {
    document.title = doc ? `${DOC_TYPES[doc.doc_type as DocType]?.label} ${doc.number ?? doc.local_number}` : 'طباعة';
  }, [doc]);
  useEffect(() => {
    if (!auto || !doc || !data) return;
    // ننتظر تحميل الخطوط ثم نفتح نافذة الطباعة
    let done = false;
    void document.fonts.ready.then(() => {
      if (!done) setTimeout(() => window.print(), 250);
    });
    return () => {
      done = true;
    };
  }, [auto, doc, data]);

  if (doc === undefined || (doc && !data)) return <div style={{ padding: 30 }}>جارٍ التحضير…</div>;
  if (!doc) return <div style={{ padding: 30 }}>المستند غير موجود على هذا الجهاز</div>;
  const thermal = tpl === 'thermal80' || tpl === 'thermal58';

  return (
    <div className={`print-root tpl-${tpl}`}>
      <style>{PRINT_CSS + PAGE_CSS[tpl]}</style>
      <div className="print-toolbar no-print">
        <button className="btn" onClick={() => nav(-1)}>رجوع</button>
        <select className="select" style={{ width: 230 }} value={tpl} onChange={(e) => nav(`/print/${id}?t=${e.target.value}`, { replace: true })}>
          {templatesFor(doc, data!.insts.some((x) => x.kind === 'installment')).map((t) => (
            <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>
          ))}
        </select>
        <button className="btn primary" onClick={() => window.print()}>طباعة</button>
      </div>
      <div className={thermal ? 'paper thermal' : 'paper'}>
        {thermal ? (
          <Thermal doc={doc} d={data!} settings={settings} />
        ) : tpl === 'voucher' ? (
          <Voucher doc={doc} d={data!} settings={settings} />
        ) : tpl === 'contract' ? (
          <Contract doc={doc} d={data!} settings={settings} />
        ) : (
          <Full doc={doc} d={data!} settings={settings} delivery={tpl === 'delivery'} />
        )}
      </div>
    </div>
  );
}

type P = { doc: any; d: any; settings: Record<string, any> };
const title = (doc: any) => DOC_TYPES[doc.doc_type as DocType]?.label ?? '';
const num = (doc: any) => doc.number ?? doc.local_number;

function Header({ doc, settings, label }: { doc: any; settings: Record<string, any>; label?: string }) {
  return (
    <div className="p-head">
      <div className="p-company">
        {settings.print_logo && <img src={settings.print_logo} alt="" className="p-logo" />}
        <div>
          <div className="p-cname">{settings.company_name}</div>
          {settings.company_address && <div>{settings.company_address}</div>}
          {settings.company_phone && <div className="ltr">{settings.company_phone}</div>}
          {settings.company_tax_no && <div>رقم التسجيل الضريبي: <span className="ltr">{settings.company_tax_no}</span></div>}
        </div>
      </div>
      <div className="p-docbox">
        <div className="p-title">{label ?? title(doc)}</div>
        <div>رقم: <b className="ltr">{num(doc)}</b></div>
        <div>التاريخ: <span className="ltr">{doc.date}</span></div>
        {doc.status === 'cancelled' && <div className="p-cancel">ملغي</div>}
        {doc.status === 'draft' && <div className="p-cancel">مسودة</div>}
      </div>
    </div>
  );
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="p-signs">
      {labels.map((l) => (
        <div key={l}><div className="p-signline" />{l}</div>
      ))}
    </div>
  );
}

function Full({ doc, d, settings, delivery }: P & { delivery: boolean }) {
  const info = DOC_TYPES[doc.doc_type as DocType];
  const priced = !delivery && (info.priced || doc.doc_type === 'opening_stock');
  const charges: any[] = doc.data?.charges ?? [];
  const payments: any[] = doc.data?.payments ?? [];
  return (
    <>
      <Header doc={doc} settings={settings} label={delivery ? `إذن تسليم بضاعة — ${title(doc)}` : undefined} />
      <div className="p-info">
        {d.party && <Cell k={d.party.kind === 'supplier' ? 'المورد' : 'العميل'} v={<>{d.party.name}{d.party.phone ? <span className="ltr"> — {d.party.phone}</span> : null}{d.party.address ? ` — ${d.party.address}` : ''}{d.party.tax_no ? <> — ر.ض <span className="ltr">{d.party.tax_no}</span></> : null}</>} />}
        {d.wh && <Cell k={d.wh2 ? 'من مخزن' : 'المخزن'} v={d.wh.name} />}
        {d.wh2 && <Cell k="إلى مخزن" v={d.wh2.name} />}
        {info.priced && !delivery && <Cell k="طريقة الدفع" v={doc.total - doc.paid > 0 ? 'آجل' : 'نقدي'} />}
        {doc.due_date && !delivery && <Cell k="تاريخ الاستحقاق" v={<span className="ltr">{doc.due_date}</span>} />}
        {d.rep && <Cell k="المندوب" v={d.rep.name} />}
        {doc.shipping_company && <Cell k="الشحن" v={doc.shipping_company} />}
      </div>
      {d.lines.length > 0 && (
        <table className="p-table">
          <thead>
            <tr>
              <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th>
              {priced && <><th>السعر</th><th>الخصم</th>{doc.tax > 0 && <th>الضريبة</th>}<th>الإجمالي</th></>}
              {delivery && <th>المستلم فعليًا</th>}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l: any) => {
              const it = d.items.get(l.item_id);
              return (
                <tr key={l.id}>
                  <td>{l.line_no}</td>
                  <td>
                    {it?.name}
                    {l.serials?.length ? <div className="p-small">سيريال: <span className="ltr">{l.serials.join(', ')}</span></div> : null}
                    {l.expiry ? <div className="p-small">صلاحية: <span className="ltr">{l.expiry}</span></div> : null}
                  </td>
                  <td>{l.unit_name}</td>
                  <td className="n">{formatQty(l.qty)}</td>
                  {priced && <><td className="n">{formatMoney(l.price)}</td><td className="n">{(l.discount || l.doc_discount) ? formatMoney((l.discount ?? 0) + (l.doc_discount ?? 0)) : ''}</td>{doc.tax > 0 && <td className="n">{formatMoney(l.tax ?? 0)}</td>}<td className="n">{formatMoney(l.total ?? 0)}</td></>}
                  {delivery && <td />}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {doc.doc_type === 'journal_voucher' && (
        <table className="p-table">
          <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead>
          <tbody>{(doc.data?.journal_lines ?? []).map((l: any, i: number) => <JvRow key={i} l={l} />)}</tbody>
        </table>
      )}
      {!delivery && (
        <div className="p-bottom">
          <div className="p-notes">
            {doc.notes && <div><b>ملاحظات:</b> {doc.notes}</div>}
            {priced && doc.total > 0 && <div className="p-words">{tafqeetEGP(doc.total)}</div>}
            {payments.length > 0 && <div><b>السداد:</b> {payments.map((p) => `${d.cbs.get(p.cashbox_id)?.name}: ${formatMoney(p.amount)}`).join(' · ')}</div>}
            {d.insts.length > 0 && <div><b>شيكات وأقساط:</b> {d.insts.map((x: any) => `${x.kind === 'cheque' ? `شيك ${x.cheque_no ?? ''}` : 'قسط'} ${x.due_date}: ${formatMoney(x.amount)}`).join(' · ')}</div>}
            {settings.print_show_balance && d.party && d.party.id !== 'party-cash-customer' && (
              <div><b>رصيد الحساب الحالي:</b> <span className="ltr">{formatMoney(d.party.balance ?? 0)}</span></div>
            )}
          </div>
          <table className="p-totals">
            <tbody>
              {info.priced && <tr><td>الإجمالي قبل الخصم</td><td className="n">{formatMoney(doc.gross)}</td></tr>}
              {info.priced && doc.discount > 0 && <tr><td>الخصومات</td><td className="n">{formatMoney(doc.discount)}</td></tr>}
              {info.priced && doc.tax > 0 && <tr><td>الضريبة</td><td className="n">{formatMoney(doc.tax)}</td></tr>}
              {charges.filter((c) => c.mode === 'add').map((c) => <tr key={c.id}><td>{c.name}</td><td className="n">{formatMoney(c.amount)}</td></tr>)}
              <tr className="p-grand"><td>الإجمالي</td><td className="n">{formatMoney(doc.total)}</td></tr>
              {info.priced && <tr><td>المسدد</td><td className="n">{formatMoney(doc.paid)}</td></tr>}
              {info.priced && doc.total - doc.paid !== 0 && <tr className="p-grand"><td>المتبقي</td><td className="n">{formatMoney(doc.total - doc.paid)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {delivery && doc.notes && <div style={{ marginTop: 10 }}><b>ملاحظات:</b> {doc.notes}</div>}
      <Signatures labels={delivery ? ['أمين المخزن', 'المستلم'] : info.priced ? ['المحاسب', d.party?.kind === 'supplier' ? 'المورد' : 'العميل'] : ['أعده', 'اعتمده']} />
      {settings.invoice_footer && <div className="p-footer">{settings.invoice_footer}</div>}
      <div className="p-meta">طُبع {new Date().toLocaleString('ar-EG')}{d.user ? ` — أعده ${d.user.full_name}` : ''}</div>
    </>
  );
}

function JvRow({ l }: { l: any }) {
  const acc = useLiveQuery(() => db.accounts.get(l.account_id), [l.account_id]);
  const party = useLiveQuery(async () => (l.party_id ? db.parties.get(l.party_id) : undefined), [l.party_id]);
  return (
    <tr>
      <td>{acc?.code} — {acc?.name}{party ? ` / ${party.name}` : ''}</td>
      <td className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
      <td className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
      <td>{l.memo}</td>
    </tr>
  );
}

function Voucher({ doc, d, settings }: P) {
  const t = doc.doc_type;
  const incoming = t === 'receipt' || t === 'income' || t === 'partner_capital';
  const who =
    d.party?.name ?? d.partner?.name ?? (t === 'cash_transfer' ? `${d.cbs.get(doc.cashbox_id)?.name} ← ${d.cbs.get(doc.to_cashbox_id)?.name}` : d.acc?.name) ?? '';
  return (
    <>
      <Header doc={doc} settings={settings} />
      <div className="p-voucher">
        <div className="p-amount"><span>المبلغ</span><b className="ltr">{formatMoney(doc.total)} ج.م</b></div>
        <div className="p-line"><span>{incoming ? 'استلمنا من' : t === 'cash_transfer' ? 'تحويل' : 'صرفنا إلى'}:</span><b>{who}</b></div>
        <div className="p-line"><span>مبلغ وقدره:</span><b>{tafqeetEGP(doc.total)}</b></div>
        {d.acc && d.party && <div className="p-line"><span>الحساب:</span><b>{d.acc.name}</b></div>}
        <div className="p-line"><span>{incoming ? 'في خزينة' : 'من خزينة'}:</span><b>{d.cbs.get(doc.cashbox_id)?.name}</b></div>
        {doc.notes && <div className="p-line"><span>وذلك عن:</span><b>{doc.notes}</b></div>}
      </div>
      <Signatures labels={['أمين الخزينة', 'المحاسب', incoming ? 'المسلِّم' : 'المستلم']} />
      <div className="p-meta">طُبع {new Date().toLocaleString('ar-EG')}{d.user ? ` — أعده ${d.user.full_name}` : ''}</div>
    </>
  );
}

function Contract({ doc, d, settings }: P) {
  const inst = d.insts.filter((x: any) => x.kind === 'installment');
  const instTotal = inst.reduce((s: number, x: any) => s + x.amount, 0);
  const down = doc.total - instTotal;
  return (
    <>
      <Header doc={doc} settings={settings} label="عقد بيع بالتقسيط" />
      <p className="p-para">
        إنه في يوم <b className="ltr">{doc.date}</b> تم الاتفاق بين كل من: <b>{settings.company_name}</b> (طرف أول — بائع)، و<b>{d.party?.name}</b>
        {d.party?.address ? ` المقيم في ${d.party.address}` : ''}
        {d.party?.phone ? <> — هاتف <span className="ltr">{d.party.phone}</span></> : null} (طرف ثانٍ — مشترٍ)، على بيع الأصناف التالية بموجب الفاتورة رقم <b className="ltr">{num(doc)}</b>:
      </p>
      <table className="p-table">
        <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>
          {d.lines.map((l: any) => (
            <tr key={l.id}>
              <td>{l.line_no}</td>
              <td>{d.items.get(l.item_id)?.name}{l.serials?.length ? <div className="p-small">سيريال: <span className="ltr">{l.serials.join(', ')}</span></div> : null}</td>
              <td className="n">{formatQty(l.qty)} {l.unit_name}</td>
              <td className="n">{formatMoney(l.price)}</td>
              <td className="n">{formatMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="p-totals" style={{ margin: '10px 0' }}>
        <tbody>
          <tr className="p-grand"><td>إجمالي الثمن</td><td className="n">{formatMoney(doc.total)}</td></tr>
          <tr><td>المقدم المدفوع وما يعادله</td><td className="n">{formatMoney(down)}</td></tr>
          <tr className="p-grand"><td>الباقي على أقساط</td><td className="n">{formatMoney(instTotal)}</td></tr>
        </tbody>
      </table>
      <p className="p-para">إجمالي الثمن: <b>{tafqeetEGP(doc.total)}</b>. ويلتزم الطرف الثاني بسداد الباقي على {inst.length} قسط حسب الجدول التالي:</p>
      <table className="p-table">
        <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ</th><th>تاريخ السداد</th><th>توقيع المستلم</th></tr></thead>
        <tbody>
          {inst.map((x: any, i: number) => (
            <tr key={x.id}><td>{i + 1}</td><td className="ltr">{x.due_date}</td><td className="n">{formatMoney(x.amount)}</td><td>{x.status === 'collected' ? 'مسدد' : ''}</td><td /></tr>
          ))}
        </tbody>
      </table>
      <div className="p-terms">{settings.print_contract_terms || DEFAULT_TERMS}</div>
      <Signatures labels={['الطرف الأول (البائع)', 'الطرف الثاني (المشتري)', 'الضامن']} />
    </>
  );
}

const DEFAULT_TERMS = `شروط العقد:
1) يلتزم الطرف الثاني بسداد الأقساط في مواعيدها المذكورة أعلاه دون تأخير.
2) في حالة التأخر عن سداد قسطين متتاليين يحق للطرف الأول المطالبة بباقي الأقساط دفعة واحدة.
3) تظل ملكية البضاعة للطرف الأول حتى سداد كامل الثمن.
4) حُرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها.`;

function Thermal({ doc, d, settings }: P) {
  const info = DOC_TYPES[doc.doc_type as DocType];
  const charges: any[] = doc.data?.charges ?? [];
  const payments: any[] = doc.data?.payments ?? [];
  return (
    <>
      <div className="t-center">
        {settings.print_logo && <img src={settings.print_logo} alt="" className="t-logo" />}
        <div className="t-cname">{settings.company_name}</div>
        {settings.company_address && <div>{settings.company_address}</div>}
        {settings.company_phone && <div className="ltr">{settings.company_phone}</div>}
        {settings.company_tax_no && <div>ر.ض <span className="ltr">{settings.company_tax_no}</span></div>}
      </div>
      <div className="t-sep" />
      <div className="t-row"><span>{title(doc)}</span><b className="ltr">{num(doc)}</b></div>
      <div className="t-row"><span>التاريخ</span><span className="ltr">{doc.date} {doc.created_at ? new Date(doc.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
      {d.party && d.party.id !== 'party-cash-customer' && <div className="t-row"><span>العميل</span><span>{d.party.name}</span></div>}
      {d.user && <div className="t-row"><span>الكاشير</span><span>{d.user.full_name}</span></div>}
      <div className="t-sep" />
      {info.priced ? (
        d.lines.map((l: any) => (
          <div key={l.id} className="t-item">
            <div>{d.items.get(l.item_id)?.name}</div>
            <div className="t-row"><span className="ltr">{formatQty(l.qty)} × {formatMoney(l.price)}</span><b className="ltr">{formatMoney(l.total)}</b></div>
            {(l.discount || l.doc_discount) ? <div className="t-row t-small"><span>خصم</span><span className="ltr">-{formatMoney((l.discount ?? 0) + (l.doc_discount ?? 0))}</span></div> : null}
          </div>
        ))
      ) : (
        <>
          <div className="t-row"><span>{d.party?.name ?? d.partner?.name ?? d.acc?.name}</span></div>
          {doc.notes && <div>{doc.notes}</div>}
        </>
      )}
      <div className="t-sep" />
      {info.priced && doc.discount > 0 && <div className="t-row"><span>الخصومات</span><span className="ltr">{formatMoney(doc.discount)}</span></div>}
      {info.priced && doc.tax > 0 && <div className="t-row"><span>الضريبة</span><span className="ltr">{formatMoney(doc.tax)}</span></div>}
      {charges.filter((c) => c.mode === 'add').map((c) => <div key={c.id} className="t-row"><span>{c.name}</span><span className="ltr">{formatMoney(c.amount)}</span></div>)}
      <div className="t-row t-grand"><span>الإجمالي</span><span className="ltr">{formatMoney(doc.total)}</span></div>
      {payments.map((p) => <div key={p.id} className="t-row"><span>{d.cbs.get(p.cashbox_id)?.name}</span><span className="ltr">{formatMoney(p.amount)}</span></div>)}
      {info.priced && doc.total - doc.paid > 0 && <div className="t-row"><span>المتبقي (آجل)</span><span className="ltr">{formatMoney(doc.total - doc.paid)}</span></div>}
      <div className="t-sep" />
      {settings.invoice_footer && <div className="t-center">{settings.invoice_footer}</div>}
      <div className="t-center t-small">{doc.status === 'cancelled' ? '*** ملغي ***' : 'شكرًا لزيارتكم'}</div>
    </>
  );
}

function Cell({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="p-cell"><span>{k}</span><b>{v}</b></div>
  );
}

const PRINT_CSS = `
.print-root { background: #e9e9ee; min-height: 100vh; padding: 16px 0 40px; color: #000; }
.print-toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: rgba(242,242,247,.9); backdrop-filter: blur(20px); margin-bottom: 14px; }
.paper { background: #fff; margin: 0 auto; width: 210mm; min-height: 280mm; padding: 14mm; box-shadow: 0 4px 24px rgba(0,0,0,.12); font-size: 11.5pt; line-height: 1.5; }
.tpl-a5 .paper { width: 148mm; min-height: 200mm; padding: 9mm; font-size: 10pt; }
.tpl-voucher .paper { width: 210mm; min-height: 140mm; padding: 10mm; }
.paper.thermal { width: 80mm; min-height: auto; padding: 3mm; font-size: 9.5pt; font-family: var(--font); }
.tpl-thermal58 .paper.thermal { width: 58mm; padding: 2mm; font-size: 8pt; }
.ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
.n { text-align: left; white-space: nowrap; font-variant-numeric: tabular-nums; }
.p-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
.p-company { display: flex; gap: 10px; align-items: center; }
.p-logo { max-height: 60px; max-width: 120px; object-fit: contain; }
.p-cname { font-size: 1.45em; font-weight: 700; }
.p-docbox { text-align: left; border: 1px solid #000; border-radius: 6px; padding: 6px 10px; min-width: 150px; }
.p-title { font-size: 1.25em; font-weight: 700; text-align: center; margin-bottom: 2px; }
.p-cancel { color: #c00; font-weight: 700; text-align: center; border: 2px solid #c00; margin-top: 4px; }
.p-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 16px; margin-bottom: 10px; }
.p-cell span { color: #444; margin-left: 6px; }
.p-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
.p-table th, .p-table td { border: 1px solid #555; padding: 4px 6px; text-align: start; vertical-align: top; }
.p-table th { background: #eee; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: 700; }
.p-small { font-size: .82em; color: #333; }
.p-bottom { display: flex; gap: 16px; align-items: flex-start; margin-top: 8px; }
.p-notes { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.p-words { font-weight: 700; border: 1px dashed #777; padding: 4px 8px; border-radius: 4px; }
.p-totals { border-collapse: collapse; min-width: 220px; }
.p-totals td { border: 1px solid #555; padding: 3px 8px; }
.p-grand td { font-weight: 700; background: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.p-signs { display: flex; justify-content: space-around; gap: 20px; margin-top: 34px; text-align: center; }
.p-signs > div { min-width: 120px; }
.p-signline { border-bottom: 1px dotted #000; height: 28px; margin-bottom: 4px; }
.p-footer { text-align: center; margin-top: 18px; font-weight: 600; }
.p-meta { text-align: center; color: #666; font-size: .78em; margin-top: 10px; }
.p-voucher { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; font-size: 1.1em; }
.p-amount { display: flex; justify-content: space-between; align-items: center; border: 2px solid #000; border-radius: 8px; padding: 8px 14px; font-size: 1.2em; }
.p-line { display: flex; gap: 10px; border-bottom: 1px dotted #888; padding-bottom: 6px; }
.p-line span { min-width: 110px; color: #333; }
.p-para { margin: 8px 0; line-height: 1.9; }
.p-terms { white-space: pre-wrap; border: 1px solid #999; padding: 8px 10px; margin-top: 12px; font-size: .92em; line-height: 1.8; }
.t-center { text-align: center; }
.t-logo { max-width: 60%; max-height: 50px; display: block; margin: 0 auto 4px; }
.t-cname { font-weight: 700; font-size: 1.3em; }
.t-sep { border-top: 1px dashed #000; margin: 5px 0; }
.t-row { display: flex; justify-content: space-between; gap: 6px; }
.t-item { margin-bottom: 3px; }
.t-small { font-size: .85em; }
.t-grand { font-weight: 700; font-size: 1.25em; border-top: 1px solid #000; padding-top: 3px; margin-top: 3px; }
@media print {
  .print-root { background: #fff; padding: 0; }
  .paper { box-shadow: none; margin: 0; width: auto; min-height: auto; padding: 0; }
  .no-print { display: none !important; }
}
`;
