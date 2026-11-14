/** التقارير المالية: ميزان المراجعة والأستاذ والأرباح والميزانية والخزينة والحركة اليومية */
import { ACCOUNT_TYPE_LABEL, DOC_TYPES, formatMoney, todayISO, type DocType } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exportExcel, Field, Picker, Segmented } from '../../components/ui';
import { db } from '../../lib/db';
import { usePerm, useRemote } from '../../lib/hooks';
import { CashResultTable } from '../Partners';
import { monthStart, yearStart, docLabel, Shell, DateRange, Kpi, Section } from './shared';

// ---------------------------------------------------------------- تحليل المقبوضات والمصروفات
const T_GROUPS: Record<string, string> = { item: 'البند', type: 'نوع المستند', party: 'الطرف', cashbox: 'الخزينة', user: 'المستخدم', day: 'اليوم', month: 'الشهر' };

const tLabel = (group: string, label: string) => (group === 'item' || group === 'type' ? (label === 'jv' ? 'قيد يومية' : DOC_TYPES[label as DocType]?.label ?? label) : label);

// ---------------------------------------------------------------- ميزان المراجعة
export function TrialBalanceReport() {
  const nav = useNavigate();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayISO());
  const [level, setLevel] = useState<'all' | 'leaf'>('all');
  const r = useRemote<any>(`/api/reports/trial-balance?from=${from}&to=${to}`);
  const rows = (r.data?.accounts ?? []).filter((a: any) => (a.opening || a.debit || a.credit || a.closing) && (level === 'all' || !a.is_group));
  const depth = (a: any) => {
    let d = 0;
    let p = a.parent_id;
    const m = new Map((r.data?.accounts ?? []).map((x: any) => [x.id, x]));
    while (p) {
      d++;
      p = (m.get(p) as any)?.parent_id;
    }
    return d;
  };
  return (
    <Shell
      title="ميزان المراجعة"
      sub={r.data && (r.data.balanced ? <span className="badge green">متوازن</span> : <span className="badge red">غير متوازن</span>)}
      error={r.error}
      loading={r.loading}
      filters={<><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /><Field label="المستوى"><Segmented block value={level} onChange={setLevel} options={[{ value: 'all', label: 'بالتجميع' }, { value: 'leaf', label: 'الفرعية فقط' }]} /></Field></>}
      actions={r.data && <button className="btn" onClick={() => exportExcel('ميزان المراجعة', ['الرقم', 'الحساب', 'رصيد أول المدة', 'مدين', 'دائن', 'الرصيد الختامي'], rows.map((a: any) => [a.code, a.name, formatMoney(a.opening), formatMoney(a.debit), formatMoney(a.credit), formatMoney(a.closing)]))}>تصدير Excel</button>}
      note="الرصيد موجب = مدين، سالب = دائن. الحسابات الرئيسية تجمع أرصدة فروعها؛ الإجمالي محسوب من الحسابات الفرعية فقط."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الرقم</th><th>الحساب</th><th className="n">أول المدة</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody>
              {rows.map((a: any) => (
                <tr key={a.id} className={a.is_group ? '' : 'click'} onClick={() => !a.is_group && nav(`/reports/ledger?account=${a.id}&from=${from}&to=${to}`)}>
                  <td className="num">{a.code}</td>
                  <td style={{ paddingInlineStart: 12 + (level === 'all' ? depth(a) * 18 : 0) }} className={a.is_group ? 'bold' : ''}>{a.name}</td>
                  <td className="n">{formatMoney(a.opening)}</td>
                  <td className="n">{formatMoney(a.debit)}</td>
                  <td className="n">{formatMoney(a.credit)}</td>
                  <td className={`n ${a.is_group ? 'bold' : ''}`}>{formatMoney(a.closing)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="n">{formatMoney(r.data.totals.debit)}</td><td className="n">{formatMoney(r.data.totals.credit)}</td><td className="n">{formatMoney(r.data.totals.closing_debit)} / {formatMoney(r.data.totals.closing_credit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- دفتر الأستاذ
export function LedgerReport() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];
  const opts = useMemo(() => accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}`, search: `${a.code} ${a.name}` })), [accounts]);
  const [from, setFrom] = useState(sp.get('from') ?? yearStart());
  const [to, setTo] = useState(sp.get('to') ?? todayISO());
  const id = sp.get('account');
  const r = useRemote<any>(id ? `/api/reports/ledger/${id}?from=${from}&to=${to}` : null);
  return (
    <Shell
      title="دفتر الأستاذ"
      sub={r.data && `${r.data.account.code} — ${r.data.account.name} (${ACCOUNT_TYPE_LABEL[r.data.account.type]})`}
      error={r.error}
      loading={r.loading}
      filters={<><Field label="الحساب"><Picker value={id} options={opts} onChange={(v) => setSp(v ? { account: v } : {})} /></Field><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /></>}
      actions={r.data && <button className="btn" onClick={() => exportExcel('دفتر الأستاذ', ['التاريخ', 'القيد', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'], r.data.lines.map((l: any) => [l.date, l.entry_no, l.doc_number, l.memo ?? l.entry_memo, formatMoney(l.debit), formatMoney(l.credit), formatMoney(l.balance)]))}>تصدير Excel</button>}
      note="للحساب الرئيسي تُعرض حركات كل فروعه. الرصيد موجب = مدين."
    >
      {!id && <div className="card pad muted">اختر حسابًا.</div>}
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>التاريخ</th><th>القيد</th><th>المستند</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="muted">رصيد أول المدة</td><td className="n bold">{formatMoney(r.data.opening)}</td></tr>
              {r.data.lines.map((l: any, i: number) => (
                <tr key={i} className={l.document_id ? 'click' : ''} onClick={() => l.document_id && nav(`/docs/view/${l.document_id}`)}>
                  <td data-label="التاريخ" className="num">{l.date}</td>
                  <td data-label="القيد" className="num">{l.entry_no}</td>
                  <td data-label="المستند" className="num">{l.doc_number}</td>
                  <td data-label="البيان">{l.memo ?? l.entry_memo}{l.party_name ? ` — ${l.party_name}` : ''}</td>
                  <td data-label="مدين" className="n">{l.debit ? formatMoney(l.debit) : ''}</td>
                  <td data-label="دائن" className="n">{l.credit ? formatMoney(l.credit) : ''}</td>
                  <td data-label="الرصيد" className="n bold">{formatMoney(l.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6}>الرصيد الختامي</td><td className="n">{formatMoney(r.data.closing)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- قائمة الدخل
export function IncomeReport() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/income-statement?from=${from}&to=${to}`);
  const cr = useRemote<any>(`/api/reports/cash-result?from=${from}&to=${to}`);
  const d = r.data;
  return (
    <Shell title="قائمة الدخل" error={r.error} loading={r.loading} filters={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      note="محسوبة من القيود المرحّلة فقط. مجمل الربح = صافي المبيعات (بعد المردودات والخصم المسموح) − تكلفة البضاعة المباعة بالمتوسط المرجح. صافي الربح ليس رصيد الخزينة.">
      {d && (
        <div className="stack">
          <div className="grid grid-4">
            <Kpi label="صافي المبيعات" v={d.net_sales} />
            <Kpi label="تكلفة البضاعة المباعة" v={d.cogs} />
            <Kpi label="مجمل الربح" v={d.gross_profit} strong />
            <Kpi label="صافي الربح" v={d.net_profit} strong />
          </div>
          <Section title="الإيرادات" rows={d.revenue} total={d.total_revenue} />
          <Section title="المصروفات والتكاليف" rows={d.expenses} total={d.total_expenses} />
          <div className="card pad row"><span className="bold" style={{ flex: 1, fontSize: 20 }}>صافي الربح المحاسبي (الخسارة)</span><span className={`num bold ${d.net_profit < 0 ? 'red' : 'green'}`} style={{ fontSize: 22 }}>{formatMoney(d.net_profit)}</span></div>
          {cr.data && (
            <div className="card pad">
              <div className="section-title" style={{ marginTop: 0 }}>النتيجة النقدية للفترة (منفصلة عن الربح المحاسبي)</div>
              <CashResultTable d={cr.data} />
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- الميزانية
export function BalanceSheetReport() {
  const [to, setTo] = useState(todayISO());
  const r = useRemote<any>(`/api/reports/balance-sheet?to=${to}`);
  const d = r.data;
  const block = (title: string, rows: any[], total: number, extra?: ReactNode) => (
    <div>
      <div className="group-header">{title}</div>
      <div className="list">
        {rows.map((x) => (
          <div key={x.id} className="list-row"><span className="num muted" style={{ width: 64 }}>{x.code}</span><div className="title">{x.name}</div><span className="num">{formatMoney(x.amount)}</span></div>
        ))}
        {extra}
        <div className="list-row"><div className="title bold">الإجمالي</div><span className="num bold">{formatMoney(total)}</span></div>
      </div>
    </div>
  );
  return (
    <Shell
      title="الميزانية العمومية"
      sub={d && (d.balanced ? <span className="badge green">الأصول = الخصوم + حقوق الملكية</span> : <span className="badge red">غير متوازنة</span>)}
      error={r.error}
      loading={r.loading}
      filters={<Field label="في تاريخ"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
      note="أرباح الفترة غير المقفلة تظهر ضمن حقوق الملكية حتى يتم إقفال السنة المالية."
    >
      {d && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {block('الأصول', d.assets, d.total_assets)}
          <div className="stack">
            {block('الخصوم', d.liabilities, d.total_liabilities)}
            {block('حقوق الملكية', d.equity, d.total_equity, <div className="list-row"><div className="title">أرباح (خسائر) الفترة الحالية</div><span className={`num ${d.current_profit < 0 ? 'red' : ''}`}>{formatMoney(d.current_profit)}</span></div>)}
            <div className="card pad row"><span className="bold" style={{ flex: 1 }}>الخصوم + حقوق الملكية</span><span className="num bold">{formatMoney(d.total_liabilities + d.total_equity)}</span></div>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function TreasuryAnalysisReport() {
  const [sp] = useSearchParams();
  const [dir, setDir] = useState<'in' | 'out'>(sp.get('dir') === 'out' ? 'out' : 'in');
  useEffect(() => setDir(sp.get('dir') === 'out' ? 'out' : 'in'), [sp]);
  const [group, setGroup] = useState('item');
  const [box, setBox] = useState('');
  const [user, setUser] = useState('');
  const [internal, setInternal] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const boxes = useLiveQuery(() => db.cashboxes.toArray(), []) ?? [];
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const r = useRemote<any>(`/api/reports/treasury-analysis?dir=${dir}&group=${group}&from=${from}&to=${to}&cashbox_id=${box}&user_id=${user}&internal=${internal ? 1 : 0}`);
  const title = dir === 'in' ? 'تحليل المقبوضات' : 'تحليل المصروفات والمدفوعات';
  return (
    <Shell
      title={title}
      sub={r.data ? `حسب ${T_GROUPS[group]} · الإجمالي ${formatMoney(r.data.total)}` : `حسب ${T_GROUPS[group]}`}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <Field label="النوع"><Segmented block value={dir} onChange={setDir} options={[{ value: 'in', label: 'مقبوضات' }, { value: 'out', label: 'مدفوعات' }]} /></Field>
          <Field label="التجميع حسب">
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(T_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="الخزينة">
            <select className="select" value={box} onChange={(e) => setBox(e.target.value)}>
              <option value="">كل الخزائن والبنوك</option>
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="المستخدم">
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">كل المستخدمين</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="التحويلات بين الخزائن"><Segmented block value={internal ? '1' : '0'} onChange={(v) => setInternal(v === '1')} options={[{ value: '0', label: 'مستبعدة' }, { value: '1', label: 'مضمنة' }]} /></Field>
        </>
      }
      actions={r.data && <button className="btn" onClick={() => exportExcel(title, [T_GROUPS[group], 'عدد الحركات', 'المبلغ', 'النسبة %'], r.data.rows.map((x: any) => [tLabel(group, x.label), x.count, formatMoney(x.amount), (x.share_bp / 100).toFixed(1)]))}>تصدير Excel</button>}
      note="محسوب من الحركة الفعلية على الخزائن والبنوك (نقدي)، وليس من الفواتير الآجلة. المستندات الملغاة مستبعدة. التحويل بين الخزائن نقل داخلي ولا يُحسب مقبوضًا أو مصروفًا إلا إذا اخترت تضمينه."
    >
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>{T_GROUPS[group]}</th><th className="n">الحركات</th><th className="n">المبلغ</th><th className="n">من الإجمالي %</th></tr></thead>
            <tbody>
              {r.data.rows.length === 0 && <tr><td colSpan={4} className="muted">لا توجد حركات في الفترة</td></tr>}
              {r.data.rows.map((x: any) => (
                <tr key={x.key}>
                  <td data-label={T_GROUPS[group]} className="bold">{tLabel(group, x.label)}</td>
                  <td data-label="الحركات" className="n">{x.count}</td>
                  <td data-label="المبلغ" className={`n bold ${dir === 'in' ? 'green' : 'red'}`}>{formatMoney(x.amount)}</td>
                  <td data-label="النسبة" className="n">
                    <span className="share-bar"><i style={{ width: `${Math.min(100, x.share_bp / 100)}%` }} /></span> {(x.share_bp / 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>الإجمالي</td><td /><td className="n">{formatMoney(r.data.total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- الحركة اليومية
export function DailyMovementReport() {
  const nav = useNavigate();
  const can = usePerm();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [user, setUser] = useState('');
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const r = useRemote<any>(`/api/reports/daily?from=${from}&to=${to}&user_id=${user}`);
  const d = r.data;
  const sumIn = d?.cashboxes.reduce((s: number, b: any) => s + b.cash_in, 0) ?? 0;
  const sumOut = d?.cashboxes.reduce((s: number, b: any) => s + b.cash_out, 0) ?? 0;
  return (
    <Shell
      title="الحركة اليومية"
      sub={from === to ? from : `${from} ← ${to}`}
      error={r.error}
      loading={r.loading}
      filters={
        <>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="المستخدم">
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">كل المستخدمين</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </>
      }
      actions={d && <button className="btn" onClick={() => exportExcel(`الحركة اليومية ${from}`, ['الوقت', 'المستند', 'النوع', 'الطرف', 'المستخدم', 'الإجمالي', 'المدفوع', 'المتبقي'], d.docs.map((x: any) => [new Date(x.created_at).toLocaleString('ar-EG'), x.number ?? x.local_number, docLabel(x.doc_type), x.party_name ?? '', x.user_name ?? '', formatMoney(x.total), formatMoney(x.paid), ['sale_invoice', 'purchase_invoice'].includes(x.doc_type) ? formatMoney(x.total - x.paid) : '']))}>تصدير Excel</button>}
      note="المستندات المرحّلة وتحت المراجعة في الفترة (بدون عروض الأسعار والملغاة). حركة الخزائن من القيود الفعلية؛ الرصيد الختامي يشمل كل الحركات حتى لو اخترت مستخدمًا."
    >
      {d && (
        <div className="stack">
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>نوع المستند</th><th className="n">العدد</th><th className="n">الإجمالي</th><th className="n">المدفوع/المحصّل</th><th className="n">المتبقي (آجل)</th></tr></thead>
              <tbody>
                {d.by_type.length === 0 && <tr><td colSpan={5} className="muted">لا توجد مستندات</td></tr>}
                {d.by_type.map((t: any) => (
                  <tr key={t.doc_type}>
                    <td data-label="النوع" className="bold">{docLabel(t.doc_type)}</td>
                    <td data-label="العدد" className="n">{t.count}</td>
                    <td data-label="الإجمالي" className="n">{formatMoney(t.total)}</td>
                    <td data-label="المدفوع" className="n">{formatMoney(t.paid)}</td>
                    <td data-label="المتبقي" className={`n ${t.remaining ? 'orange' : 'muted'}`}>{t.remaining ? formatMoney(t.remaining) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('treasury.view') && d.cashboxes.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>الخزينة</th><th className="n">رصيد أول الفترة</th><th className="n">مقبوضات</th><th className="n">مدفوعات</th><th className="n">الرصيد آخر الفترة</th></tr></thead>
                <tbody>
                  {d.cashboxes.map((b: any) => (
                    <tr key={b.id}>
                      <td data-label="الخزينة" className="bold">{b.name}</td>
                      <td data-label="أول الفترة" className="n">{formatMoney(b.opening)}</td>
                      <td data-label="مقبوضات" className="n green">{formatMoney(b.cash_in)}</td>
                      <td data-label="مدفوعات" className="n red">{formatMoney(b.cash_out)}</td>
                      <td data-label="آخر الفترة" className="n bold">{formatMoney(b.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>الإجمالي</td><td className="n">{formatMoney(d.cashboxes.reduce((s: number, b: any) => s + b.opening, 0))}</td><td className="n">{formatMoney(sumIn)}</td><td className="n">{formatMoney(sumOut)}</td><td className="n">{formatMoney(d.cashboxes.reduce((s: number, b: any) => s + b.closing, 0))}</td></tr></tfoot>
              </table>
            </div>
          )}
          <div className="section-title" style={{ margin: '6px 0 0' }}>المستندات ({d.docs.length})</div>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>الوقت</th><th>المستند</th><th>النوع</th><th>الطرف</th><th>المستخدم</th><th className="n">الإجمالي</th><th className="n">المدفوع</th><th className="n">المتبقي</th></tr></thead>
              <tbody>
                {d.docs.map((x: any) => (
                  <tr key={x.id} className="click" onClick={() => nav(`/docs/view/${x.id}`)}>
                    <td data-label="الوقت" className="num">{new Date(x.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}{from !== to ? ` · ${x.date}` : ''}</td>
                    <td data-label="المستند" className="num">{x.number ?? x.local_number} {x.status === 'pending_review' && <span className="badge orange">مراجعة</span>}</td>
                    <td data-label="النوع">{docLabel(x.doc_type)}</td>
                    <td data-label="الطرف">{x.party_name ?? ''}</td>
                    <td data-label="المستخدم" className="muted">{x.user_name ?? ''}</td>
                    <td data-label="الإجمالي" className="n">{formatMoney(x.total)}</td>
                    <td data-label="المدفوع" className="n">{formatMoney(x.paid)}</td>
                    <td data-label="المتبقي" className="n">{['sale_invoice', 'purchase_invoice'].includes(x.doc_type) && x.total - x.paid ? formatMoney(x.total - x.paid) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
