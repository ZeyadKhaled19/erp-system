import { formatMoney } from '@erp/shared';
import { Check, Copy, KeyRound, MessageCircle, RefreshCw, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, Field, MoneyInput, Segmented, Sheet, useUi } from '../components/ui';
import { api } from '../lib/api';
import { waUrl } from '../lib/license';

interface Signup { id: string; name: string; phone: string; business: string; activity: string | null; governorate: string | null; city: string | null; status: 'new' | 'contacted' | 'activated' | 'dropped'; notes: string | null; created_at: string }
interface License { id: string; machine_id: string; customer: string; phone: string | null; plan: string; expires_at: string | null; code: string; amount: number | string; created_at: string; created_by_name: string | null }

const STATUS: Record<Signup['status'], { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'orange' },
  contacted: { label: 'اتكلمنا معاه', cls: '' },
  activated: { label: 'اتفعّل', cls: 'green' },
  dropped: { label: 'مش مهتم', cls: 'red' },
};
const PLAN: Record<string, string> = { month: 'شهر', quarter: '3 شهور', year: 'سنة', life: 'مدى الحياة', days: 'أيام' };
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
const waLink = (phone: string, text: string) => waUrl(phone, text);

function CopyBtn({ text, label = 'نسخ' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* */ } }}>
      {ok ? <><Check /> اتنسخ</> : <><Copy /> {label}</>}
    </button>
  );
}

/** إصدار كود تفعيل لجهاز */
function IssueSheet({ signup, onClose, onDone }: { signup: Signup | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ machine_id: '', customer: signup?.business ?? '', phone: signup?.phone ?? '', plan: 'year' as 'month' | 'quarter' | 'year' | 'life' | 'days', days: 30, amount: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ code: string; machine_id: string; expires_at: string | null } | null>(null);
  const issue = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ code: string; machine_id: string; expires_at: string | null }>('/api/admin/licenses', {
        body: { machine_id: f.machine_id, customer: f.customer, phone: f.phone || null, plan: f.plan, days: f.plan === 'days' ? Number(f.days) : undefined, signup_id: signup?.id ?? null, amount: f.amount },
      });
      setRes(r);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const msg = res ? `كود تفعيل Eco System لـ «${f.customer}»:\n${res.code}\n\nافتح البرنامج ← دوس «تفعيل» ← الصق الكود.` : '';
  return (
    <Sheet title={res ? 'كود التفعيل جاهز' : 'كود تفعيل جديد'} onClose={onClose} footer={res ? <button className="btn primary" onClick={onClose}>تمام</button> : <><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy} onClick={issue}><KeyRound /> طلّع الكود</button></>}>
      {res ? (
        <div className="stack">
          <Banner kind="ok">الكود ده شغال على الجهاز <bdi dir="ltr">{res.machine_id}</bdi> بس، {res.expires_at ? `لحد ${res.expires_at}` : 'مدى الحياة'}.</Banner>
          <textarea className="textarea num lic-code" dir="ltr" readOnly value={res.code} onFocus={(e) => e.currentTarget.select()} />
          <div className="row wrap" style={{ gap: 8 }}>
            <CopyBtn text={res.code} label="نسخ الكود" />
            <CopyBtn text={msg} label="نسخ الرسالة كاملة" />
            {f.phone && <a className="btn sm" href={waLink(f.phone, msg)} target="_blank" rel="noreferrer"><MessageCircle /> ابعته واتساب</a>}
          </div>
        </div>
      ) : (
        <div className="stack">
          {err && <Banner kind="err">{err}</Banner>}
          <Field label="رقم الجهاز" required hint="العميل بيلاقيه في شاشة التفعيل في البرنامج، زي A1B2-C3D4-E5F6-0718">
            <input className="input num" dir="ltr" autoFocus value={f.machine_id} onChange={(e) => setF({ ...f, machine_id: e.target.value })} placeholder="XXXX-XXXX-XXXX-XXXX" />
          </Field>
          <Field label="اسم العميل أو المحل" required><input className="input" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
          <Field label="الموبايل"><input className="input num" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="المدة">
            <Segmented value={f.plan} onChange={(v) => setF({ ...f, plan: v })} options={[{ value: 'month', label: 'شهر' }, { value: 'quarter', label: '3 شهور' }, { value: 'year', label: 'سنة' }, { value: 'life', label: 'مدى الحياة' }, { value: 'days', label: 'أيام' }]} />
          </Field>
          <Field label="المبلغ المدفوع" hint="علشان الدخل يتحسب في لوحة صاحب السيستم (0 لو مجاني)"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          {f.plan === 'days' && <Field label="عدد الأيام"><input className="input num" type="number" min={1} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) || 1 })} /></Field>}
        </div>
      )}
    </Sheet>
  );
}

export function LicensesPage() {
  const ui = useUi();
  const [data, setData] = useState<{ canIssue: boolean; signups: Signup[]; licenses: License[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'signups' | 'licenses'>('signups');
  const [issue, setIssue] = useState<Signup | null | undefined>(undefined);
  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await api('/api/admin/licensing'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const setStatus = async (s: Signup, status: Signup['status']) => {
    try {
      await api(`/api/admin/trial-signups/${s.id}`, { body: { status } });
      void load();
    } catch (e) {
      ui.toast((e as Error).message, 'err');
    }
  };
  const newCount = data?.signups.filter((s) => s.status === 'new').length ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="التراخيص والتجارب"
        sub="اللي سجلوا في التجربة المجانية، وأكواد التفعيل اللي طلعت"
        actions={<>
          <button className="btn" onClick={() => void load()}><RefreshCw /> تحديث</button>
          {data?.canIssue && <button className="btn primary" onClick={() => setIssue(null)}><KeyRound /> كود تفعيل جديد</button>}
        </>}
      />
      {err && <Banner kind="err">{err}</Banner>}
      {data && !data.canIssue && <Banner kind="warn">علشان تقدر تطلّع أكواد تفعيل، لازم مفتاح التوقيع يتحط في إعدادات Vercel باسم LICENSE_PRIVATE_KEY.</Banner>}
      <div className="footnote" style={{ marginBottom: 10 }}>
        لينك صفحة التسجيل اللي تبعته للناس: <bdi dir="ltr" className="bold">{window.location.origin}/signup</bdi> <CopyBtn text={`${window.location.origin}/signup`} label="نسخ اللينك" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'signups', label: `اللي سجلوا${newCount ? ` (${newCount} جديد)` : ''}` }, { value: 'licenses', label: `الأكواد (${data?.licenses.length ?? 0})` }]} />
      </div>
      {!data ? null : tab === 'signups' ? (
        data.signups.length === 0 ? (
          <div className="card"><Empty icon={<UserPlus />} title="لسه محدش سجل">ابعت لينك صفحة التسجيل للناس، وكل اللي يسجل هيظهر هنا.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>التاريخ</th><th>الاسم</th><th>المحل</th><th>النشاط</th><th>الموبايل</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {data.signups.map((s) => (
                  <tr key={s.id}>
                    <td data-label="التاريخ" className="muted">{fmtDate(s.created_at)}</td>
                    <td data-label="الاسم" className="bold">{s.name}</td>
                    <td data-label="المحل">{s.business}{s.governorate || s.city ? <span className="muted"> · {[s.governorate, s.city].filter(Boolean).join('، ')}</span> : null}</td>
                    <td data-label="النشاط" className="muted">{s.activity ?? '—'}</td>
                    <td data-label="الموبايل" className="num"><a href={waLink(s.phone, `أهلًا ${s.name}، معاك Eco System بخصوص التجربة المجانية.`)} target="_blank" rel="noreferrer">{s.phone}</a></td>
                    <td data-label="الحالة">
                      <select className="select" style={{ minWidth: 130 }} value={s.status} onChange={(e) => void setStatus(s, e.target.value as Signup['status'])} aria-label={`حالة ${s.name}`}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td data-label="">{data.canIssue && <button className="btn sm" onClick={() => setIssue(s)}><KeyRound /> كود تفعيل</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : data.licenses.length === 0 ? (
        <div className="card"><Empty icon={<KeyRound />} title="لسه مفيش أكواد" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>التاريخ</th><th>العميل</th><th>رقم الجهاز</th><th>المدة</th><th>لحد</th><th className="n">المبلغ</th><th /></tr></thead>
            <tbody>
              {data.licenses.map((l) => (
                <tr key={l.id}>
                  <td data-label="التاريخ" className="muted">{fmtDate(l.created_at)}</td>
                  <td data-label="العميل" className="bold">{l.customer}{l.phone ? <span className="muted num"> · {l.phone}</span> : null}</td>
                  <td data-label="رقم الجهاز" className="num" dir="ltr">{l.machine_id}</td>
                  <td data-label="المدة">{PLAN[l.plan] ?? l.plan}</td>
                  <td data-label="لحد">{l.expires_at ? <span className={`badge ${l.expires_at < new Date().toISOString().slice(0, 10) ? 'red' : 'green'}`}>{l.expires_at}</span> : <span className="badge green">مدى الحياة</span>}</td>
                  <td data-label="المبلغ" className="n">{Number(l.amount) ? formatMoney(Number(l.amount)) : <span className="muted">—</span>}</td>
                  <td data-label=""><CopyBtn text={l.code} label="نسخ الكود" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {issue !== undefined && <IssueSheet signup={issue} onClose={() => setIssue(undefined)} onDone={() => void load()} />}
    </div>
  );
}
