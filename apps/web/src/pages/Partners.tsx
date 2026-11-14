import { bpToPercent, formatMoney, parsePercentBp, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { HandCoins, Landmark, PieChart, Plus, Users, Wallet, ArrowUpRight } from 'lucide-react';
import { QuickActions, SectionHeader, SectionStats } from '../components/Section';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ActiveBadge, Avatar, InlineTabs, RowActions } from '../components/ListParts';
import { Banner, DocStatusBadge, Empty, Field, Segmented, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveDocument, saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useRemote } from '../lib/hooks';

export function PartnersPage() {
  const can = usePerm();
  const nav = useNavigate();
  const ui = useUi();
  const partners = useLiveQuery(() => db.partners.orderBy('name').toArray(), []) ?? [];
  const dists = useLiveQuery(async () => (await db.documents.where('doc_type').equals('profit_distribution').toArray()).sort((a, b) => String(b.date).localeCompare(String(a.date))), []) ?? [];
  const rep = useRemote<any>(can('partners.view') ? '/api/reports/partners' : null, [partners.length, dists.length]);
  const [edit, setEdit] = useState<any | null>(null);
  const [dist, setDist] = useState(false);
  const [tab, setTab] = useState<'partners' | 'dists'>('partners');
  const active = partners.filter((p) => p.active !== false);
  const sumOwn = active.reduce((s, p) => s + p.ownership_bp, 0);
  const sumProfit = active.reduce((s, p) => s + p.profit_bp, 0);
  const balances = new Map<string, any>((rep.data?.partners ?? []).map((p: any) => [p.id, p]));

  const totals = (rep.data?.partners ?? []).reduce((t: any, p: any) => ({ capital: t.capital + (p.capital ?? 0), current: t.current + (p.current ?? 0), withdrawals: t.withdrawals + (p.withdrawals ?? 0) }), { capital: 0, current: 0, withdrawals: 0 });

  return (
    <div className="page">
      <InlineTabs value={tab} onChange={setTab} options={[{ value: 'partners', label: 'الشركاء' }, { value: 'dists', label: `توزيعات الأرباح${dists.length ? ` (${dists.length})` : ''}` }]} />
      <SectionHeader
        icon={<HandCoins />}
        color="purple"
        title="الشركاء"
        sub="نسبة الملكية ونسبة توزيع الأرباح منفصلتان"
        tools={
          <>
            {can('partners.create') && <button className="btn" onClick={() => setDist(true)}><PieChart /> توزيع أرباح</button>}
            {can('partners.manage') && <button className="btn primary" onClick={() => setEdit({})}><Plus /> شريك</button>}
          </>
        }
      />
      <div className="sx-top">
        <SectionStats items={[
          { key: 'count', label: 'الشركاء النشطين', value: active.length, sub: `ملكية ${bpToPercent(sumOwn)}% · أرباح ${bpToPercent(sumProfit)}%`, icon: <Users />, color: 'blue' },
          { key: 'capital', label: 'إجمالي رأس المال', value: rep.data ? formatMoney(totals.capital) : '—', icon: <Landmark />, color: 'purple' },
          { key: 'current', label: 'الحساب الجاري للشركاء', value: rep.data ? formatMoney(totals.current) : '—', sub: 'أرباح موزعة لم تُسحب', icon: <Wallet />, color: 'green', valueTone: rep.data && totals.current >= 0 ? 'green' : 'red' },
          { key: 'withdrawals', label: 'مسحوبات الفترة', value: rep.data ? formatMoney(totals.withdrawals) : '—', icon: <ArrowUpRight />, color: 'orange' },
        ]} />
        <QuickActions section="partners" defaults={['partner_capital', 'partner_withdrawal']} />
      </div>
      {active.length > 0 && (sumOwn !== 10000 || sumProfit !== 10000) && (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="warn">
            {sumOwn !== 10000 && <>مجموع نسب الملكية {bpToPercent(sumOwn)}% (الفرق {bpToPercent(10000 - sumOwn)}%). </>}
            {sumProfit !== 10000 && <>مجموع نسب توزيع الأرباح {bpToPercent(sumProfit)}% (الفرق {bpToPercent(10000 - sumProfit)}%) — لا يمكن توزيع الأرباح حتى يساوي 100%.</>}
          </Banner>
        </div>
      )}
      {tab === 'partners' && (
        <>
      {rep.error && <div style={{ marginBottom: 12 }}><Banner kind="info">الأرصدة تظهر عند الاتصال بالخادم.</Banner></div>}
      {partners.length === 0 ? (
        <div className="card"><Empty title="لا يوجد شركاء بعد" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>الشريك</th><th className="n">نسبة الملكية</th><th className="n">نسبة الأرباح</th><th className="n">رأس المال</th><th className="n">الحساب الجاري (له)</th><th className="n">مسحوبات الفترة</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {partners.map((p) => {
                const b = balances.get(p.id);
                return (
                  <tr key={p.id} className={can('partners.manage') ? 'click' : ''} onClick={() => can('partners.manage') && setEdit(p)}>
                    <td data-label="الشريك" className="bold"><span className="lp-name"><Avatar name={p.name} />{p.name}</span></td>
                    <td data-label="الملكية" className="n">{bpToPercent(p.ownership_bp)}%</td>
                    <td data-label="الأرباح" className="n">{bpToPercent(p.profit_bp)}%</td>
                    <td data-label="رأس المال" className="n">{b ? formatMoney(b.capital) : '—'}</td>
                    <td data-label="الجاري" className={`n bold ${b && b.current < 0 ? 'red' : ''}`}>{b ? formatMoney(b.current) : '—'}</td>
                    <td data-label="المسحوبات" className="n">{b ? formatMoney(b.withdrawals) : '—'}</td>
                    <td data-label="الحالة"><ActiveBadge active={p.active !== false} /></td>
                    <td data-label="" className="lp-act-cell">
                      <RowActions
                        openLabel="كشف الحساب الجاري"
                        onOpen={can('reports.financial') ? () => nav(`/reports/ledger?account=${p.current_account_id}`) : undefined}
                        onEdit={can('partners.manage') ? () => setEdit(p) : undefined}
                      >
                        <SyncBadge sync={p._sync} error={p._error} />
                      </RowActions>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>الإجمالي (النشطون)</td><td className="n">{bpToPercent(sumOwn)}%</td><td className="n">{bpToPercent(sumProfit)}%</td><td colSpan={5} /></tr></tfoot>
          </table>
        </div>
      )}
      <div className="footnote" style={{ marginTop: 8 }}>الحساب الجاري الموجب = مستحق للشريك من أرباح موزعة لم تُسحب. المسحوبات تُخصم من الحساب الجاري. رأس المال لا يُعتبر ربحًا.</div>

        </>
      )}

      {tab === 'dists' && (
        <>
      {dists.length === 0 ? (
        <div className="card pad muted">لا توجد توزيعات</div>
      ) : (
        <div className="list">
          {dists.map((d) => (
            <div key={d.id} className="list-row tappable" onClick={() => nav(`/docs/view/${d.id}`)}>
              <div className="title">
                {d.number ?? d.local_number} — الفترة <span className="num">{d.data?.period_from ?? d.period_from}</span> إلى <span className="num">{d.data?.period_to ?? d.period_to}</span>
                <div className="sub">صافي الربح {d.data?.net_profit != null ? formatMoney(d.data.net_profit) : '—'} · محتجز {d.data?.retained != null ? formatMoney(d.data.retained) : '—'}</div>
              </div>
              <DocStatusBadge status={d.status} sync={d._sync} />
              <span className="num bold">{formatMoney(d.total)}</span>
            </div>
          ))}
        </div>
      )}

        </>
      )}

      {edit && (
        <PartnerEditor
          p={edit.id ? edit : null}
          onClose={() => setEdit(null)}
          onSave={async (data) => {
            await saveMaster('partner', edit.id ?? uuid(), data, edit.id ? edit : null);
            ui.toast('تم الحفظ');
            setEdit(null);
          }}
        />
      )}
      {dist && <DistributionSheet onClose={() => setDist(false)} />}
    </div>
  );
}

function PartnerEditor({ p, onClose, onSave }: { p: any | null; onClose: () => void; onSave: (d: any) => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', phone: p?.phone ?? '', own: bpToPercent(p?.ownership_bp ?? 0), profit: bpToPercent(p?.profit_bp ?? 0), notes: p?.notes ?? '', active: p?.active ?? true });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet
      title={p ? 'تعديل شريك' : 'شريك جديد'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button
            className="btn primary"
            onClick={() => {
              try {
                const ownership_bp = parsePercentBp(f.own || '0');
                const profit_bp = parsePercentBp(f.profit || '0');
                if (!f.name.trim()) return setErr('الاسم مطلوب');
                if (ownership_bp < 0 || ownership_bp > 10000 || profit_bp < 0 || profit_bp > 10000) return setErr('النسب بين 0 و 100');
                onSave({ name: f.name.trim(), phone: f.phone || null, ownership_bp, profit_bp, notes: f.notes || null, active: f.active });
              } catch {
                setErr('نسبة غير صالحة');
              }
            }}
          >
            حفظ
          </button>
        </>
      }
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الشريك"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="الهاتف"><input className="input num" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className="grid grid-2">
          <Field label="نسبة الملكية %"><input className="input num" inputMode="decimal" value={f.own} onChange={(e) => setF({ ...f, own: e.target.value })} /></Field>
          <Field label="نسبة توزيع الأرباح %" hint="قد تختلف عن نسبة الملكية"><input className="input num" inputMode="decimal" value={f.profit} onChange={(e) => setF({ ...f, profit: e.target.value })} /></Field>
        </div>
        {!p && <div className="footnote">يُنشأ للشريك تلقائيًا حساب رأس مال وحساب جارٍ في دليل الحسابات.</div>}
        <Field label="ملاحظات"><textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="row"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} /> {f.active ? 'نشط' : 'موقوف'}</div>
      </div>
    </Sheet>
  );
}

function DistributionSheet({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const nav = useNavigate();
  const y = todayISO().slice(0, 4);
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [ret, setRet] = useState('0');
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const is = useRemote<any>(`/api/reports/income-statement?from=${from}&to=${to}`, []);
  const cr = useRemote<any>(`/api/reports/cash-result?from=${from}&to=${to}`, []);
  const partners = useLiveQuery(async () => (await db.partners.toArray()).filter((p) => p.active !== false), []) ?? [];
  let retBp = 0;
  try {
    retBp = parsePercentBp(ret || '0');
  } catch {
    retBp = -1;
  }
  const net = (basis === 'cash' ? cr.data?.result : is.data?.net_profit) ?? 0;
  const ready = basis === 'cash' ? !!cr.data : !!is.data;
  const retained = Math.round((net * Math.max(retBp, 0)) / 10000);
  const distributable = net - retained;
  const sumBp = partners.reduce((s, p) => s + p.profit_bp, 0);
  return (
    <Sheet
      title="توزيع الأرباح"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button
            className="btn primary"
            disabled={!ready || net <= 0 || sumBp !== 10000 || retBp < 0 || retBp > 10000}
            onClick={async () => {
              const id = uuid();
              await saveDocument(
                { id, doc_type: 'profit_distribution', date: to, period_from: from, period_to: to, retained_bp: retBp, profit_basis: basis, lines: [], journal_lines: [], payments: [], instruments: [], paid: 0, amount: 0, discount: 0, reserve: false, notes: `توزيع أرباح ${from} إلى ${to} (${basis === 'cash' ? 'على أساس النتيجة النقدية' : 'على أساس الربح المحاسبي'})` } as any,
                'draft',
              );
              ui.toast('أُعدت مسودة التوزيع؛ راجعها ثم اعتمدها');
              onClose();
              nav(`/docs/view/${id}`);
            }}
          >
            إعداد مسودة التوزيع
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid-3">
          <Field label="من تاريخ"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="إلى تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="نسبة الأرباح المحتجزة %"><input className="input num" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} /></Field>
        </div>
        <Field label="أساس التوزيع">
          <Segmented block value={basis} onChange={setBasis} options={[{ value: 'accrual', label: 'الربح المحاسبي' }, { value: 'cash', label: 'النتيجة النقدية' }]} />
        </Field>
        {(is.error || cr.error) && <Banner kind="warn">{is.error || cr.error}</Banner>}
        {is.data && cr.data && (
          <div className="grid grid-2">
            <button type="button" className={`card pad pr-basis ${basis === 'accrual' ? 'on' : ''}`} onClick={() => setBasis('accrual')}>
              <div className="caption">1) الربح المحاسبي</div>
              <div className={`stat-value num ${is.data.net_profit < 0 ? 'red' : ''}`}>{formatMoney(is.data.net_profit)}</div>
              <div className="footnote">المبيعات المسجلة − تكلفة البضاعة المباعة (متوسط مرجح) − مصروفات الفترة</div>
            </button>
            <button type="button" className={`card pad pr-basis ${basis === 'cash' ? 'on' : ''}`} onClick={() => setBasis('cash')}>
              <div className="caption">2) النتيجة النقدية</div>
              <div className={`stat-value num ${cr.data.result < 0 ? 'red' : ''}`}>{formatMoney(cr.data.result)}</div>
              <div className="footnote">المحصّل فعلًا من العملاء − المدفوع فعلًا (مصروفات ومورّدين)</div>
            </button>
          </div>
        )}
        {basis === 'cash' && cr.data && <CashResultTable d={cr.data} />}
        {sumBp !== 10000 && <Banner kind="err">مجموع نسب توزيع الأرباح للشركاء {bpToPercent(sumBp)}% ولا يساوي 100%.</Banner>}
        {basis === 'accrual' && is.data && (
          <div className="list">
            <div className="list-row"><div className="title">إجمالي الإيرادات</div><span className="num">{formatMoney(is.data.total_revenue)}</span></div>
            <div className="list-row"><div className="title">إجمالي المصروفات والتكاليف</div><span className="num">{formatMoney(is.data.total_expenses)}</span></div>
            <div className="list-row"><div className="title bold">صافي الربح المرحّل للفترة</div><span className={`num bold ${net < 0 ? 'red' : ''}`}>{formatMoney(net)}</span></div>
          </div>
        )}
        {ready && net > 0 && (
          <div className="list">
            <div className="list-row"><div className="title">أرباح محتجزة</div><span className="num">{formatMoney(retained)}</span></div>
            <div className="list-row"><div className="title bold">القابل للتوزيع ({basis === 'cash' ? 'نقدي' : 'محاسبي'})</div><span className="num bold">{formatMoney(Math.max(distributable, 0))}</span></div>
          </div>
        )}
        {ready && distributable > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الشريك</th><th className="n">نسبة الأرباح</th><th className="n">النصيب التقديري</th></tr></thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id}><td>{p.name}</td><td className="n">{bpToPercent(p.profit_bp)}%</td><td className="n bold">{formatMoney(Math.round((distributable * p.profit_bp) / 10000))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="footnote">
          الربح المحاسبي من القيود المرحّلة (بعد المصروفات والتكاليف والمرتجعات)، والنتيجة النقدية من حركة الخزائن الفعلية فقط (الآجل يُحسب عند تحصيله)؛ ولا أيٌّ منهما هو رصيد الخزينة.
          يُعاد حساب الأساس المختار عند الاعتماد. المسودة تُعرض للمراجعة، والاعتماد يحتاج صلاحية «اعتماد توزيع الأرباح»
          ويُنشئ قيدًا: من حـ/ توزيعات أرباح معلنة إلى حـ/ جاري كل شريك. السحب الفعلي يتم بمستند «مسحوبات شريك».
        </div>
      </div>
    </Sheet>
  );
}

const EXCLUDED_LABEL: Record<string, string> = {
  cash_transfer: 'تحويلات بين الخزائن', partner_capital: 'رأس مال الشركاء', partner_withdrawal: 'مسحوبات الشركاء', profit_distribution: 'توزيعات أرباح',
  party_opening: 'أرصدة افتتاحية', jv: 'قيود يومية (قروض/تسويات/افتتاحي)', journal_voucher: 'قيود يومية (قروض/تسويات/افتتاحي)',
  expense_non_operating: 'صرف على حسابات غير مصروفات (قروض/أصول)', income_non_operating: 'قبض على حسابات غير إيرادات (قروض/رأس مال)', opening_stock: 'بضاعة أول المدة',
};

/** تفصيل النتيجة النقدية للفترة: من أين جاءت الأرقام وما المستبعد */
export function CashResultTable({ d }: { d: any }) {
  const row = (label: string, v: number, cls = '') => (
    <div className="list-row"><div className={`title ${cls}`}>{label}</div><span className={`num ${cls} ${v < 0 ? 'red' : ''}`}>{formatMoney(v)}</span></div>
  );
  return (
    <div className="stack">
      <div className="list">
        {row('المحصّل من العملاء (نقدي + تحصيل الآجل)', d.collections)}
        {d.customer_refunds !== 0 && row('− مردود للعملاء', -d.customer_refunds)}
        {d.other_income !== 0 && row('+ إيرادات نقدية أخرى', d.other_income)}
        {row('صافي المقبوضات', d.net_collections, 'bold')}
        {row('− مصروفات تشغيلية مدفوعة', -d.operating_expenses)}
        {d.payment_fees !== 0 && row('− عمولات الدفع (بطاقات/محافظ)', -d.payment_fees)}
        {row('النتيجة قبل مدفوعات البضاعة', d.before_goods, 'bold')}
        {row('− المدفوع للموردين (شراء بضاعة)', -d.supplier_payments)}
        {d.supplier_refunds !== 0 && row('+ مردود من الموردين', d.supplier_refunds)}
        {row('النتيجة النقدية للفترة', d.result, 'bold')}
      </div>
      {d.excluded?.length > 0 && (
        <div className="footnote">
          مستبعد من النتيجة (ليس دخلًا ولا مصروفًا تشغيليًا):{' '}
          {d.excluded.map((x: any) => `${EXCLUDED_LABEL[x.doc_type] ?? x.doc_type} (وارد ${formatMoney(x.cash_in)} / منصرف ${formatMoney(x.cash_out)})`).join('، ')}
        </div>
      )}
    </div>
  );
}
