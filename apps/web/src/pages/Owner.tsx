import { formatMoney } from '@erp/shared';
import { Banknote, CalendarClock, KeyRound, Laptop, MessageCircle, Pencil, RefreshCw, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, Field, Sheet, useUi } from '../components/ui';
import { api } from '../lib/api';
import { DEFAULT_CONTACT, refreshLicense, waUrl, type VendorContact } from '../lib/license';
import '../owner.css';

interface Device { machine_id: string; governorate?: string | null; company_name: string | null; version: string | null; status: string | null; days_left: number | null; expires_at: string | null; legacy: boolean; last_seen: string; first_seen: string; customer: string | null; phone: string | null }
interface Dash {
  signups: { today: number; week: number; month: number; total: number; activated: number };
  licenses: { total: number; active: number; expiring: number };
  revenue: { month: number; lastMonth: number; total: number };
  devices: { total: number; trial: number; seenWeek: number };
  newSignups: { id: string; name: string; phone: string; business: string; created_at: string }[];
  endingTrials: { machine_id: string; company_name: string | null; days_left: number; last_seen: string }[];
  expiringLicenses: { machine_id: string; customer: string; phone: string | null; expires_at: string }[];
  installations: Device[];
  weekly: { week: string; signups: number; activations: number }[];
  byGovernorate: { governorate: string; n: number; activated: number }[];
  contact: VendorContact;
}

const ago = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 60) return m <= 1 ? 'دلوقتي' : `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? 'امبارح' : `من ${d} يوم`;
};
const shortDate = (s: string) => new Date(s).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`own-kpi ${tone ?? ''}`}>
      <div className="own-kpi-h"><span className="own-kpi-ic">{icon}</span>{label}</div>
      <div className="own-kpi-v num">{value}</div>
      {sub && <div className="own-kpi-s">{sub}</div>}
    </div>
  );
}

function DeviceStatus({ d }: { d: Device }) {
  if (d.legacy) return <span className="badge">قديم (مفتوح)</span>;
  if (d.status === 'trial') return <span className={`badge ${(d.days_left ?? 0) <= 2 ? 'red' : 'orange'}`}>تجربة · باقي {d.days_left} يوم</span>;
  if (d.status === 'active') return <span className="badge green">مفعّل{d.expires_at ? ` لحد ${d.expires_at}` : ' مدى الحياة'}</span>;
  if (d.status === 'expired') return <span className="badge red">مقفول</span>;
  return <span className="muted">—</span>;
}

/** تعديل بيانات التواصل اللي بتظهر للعملاء */
function ContactSheet({ contact, onClose, onSaved }: { contact: VendorContact; onClose: () => void; onSaved: () => void }) {
  const ui = useUi();
  const [f, setF] = useState<VendorContact>({ ...DEFAULT_CONTACT, ...contact });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api('/api/admin/vendor-contact', { body: f });
      await refreshLicense();
      ui.toast('اتحفظت بيانات التواصل');
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="بيانات التواصل" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy} onClick={save}>حفظ</button></>}>
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <div className="footnote">دي بتظهر للعملاء في صفحة التسجيل، وفي شاشة التفعيل جوه برنامج الويندوز (بتوصل للبرنامج أول ما يكون على النت). سيب أي خانة فاضية لو مش عايزها تظهر.</div>
        <div className="grid grid-2">
          <Field label="رقم التليفون"><input className="input num" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01xxxxxxxxx" /></Field>
          <Field label="رقم الواتساب"><input className="input num" dir="ltr" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="01xxxxxxxxx" /></Field>
        </div>
        <Field label="صفحة الفيسبوك"><input className="input" dir="ltr" value={f.facebook} onChange={(e) => setF({ ...f, facebook: e.target.value })} placeholder="https://facebook.com/..." /></Field>
        <Field label="قناة اليوتيوب"><input className="input" dir="ltr" value={f.youtube} onChange={(e) => setF({ ...f, youtube: e.target.value })} placeholder="https://youtube.com/@..." /></Field>
      </div>
    </Sheet>
  );
}

/** لوحة صاحب السيستم: بيع السيستم نفسه (التسجيلات، التفعيل، الفلوس، والأجهزة) */
export function OwnerDashboard() {
  const nav = useNavigate();
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editContact, setEditContact] = useState(false);
  const load = useCallback(async () => {
    setErr(null);
    try {
      setD(await api('/api/admin/owner-dashboard'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const conv = d && d.signups.total ? Math.round((d.signups.activated * 100) / d.signups.total) : 0;
  const maxWeek = Math.max(1, ...(d?.weekly ?? []).map((w) => Math.max(w.signups, w.activations)));
  const calls = (d?.newSignups.length ?? 0) + (d?.endingTrials.length ?? 0) + (d?.expiringLicenses.length ?? 0);
  const c = d?.contact;

  return (
    <div className="page">
      <PageHeader
        title="لوحة صاحب السيستم"
        sub="بيع Eco System: التسجيلات والتفعيل والفلوس والأجهزة"
        actions={<>
          <button className="btn" onClick={() => void load()}><RefreshCw /> تحديث</button>
          <button className="btn primary" onClick={() => nav('/licenses')}><KeyRound /> التراخيص والأكواد</button>
        </>}
      />
      {err && <Banner kind="err">{err}</Banner>}
      {d && (
        <>
          <div className="own-kpis">
            <Kpi icon={<UserPlus />} label="سجلوا في التجربة" value={d.signups.month} sub={<>النهارده {d.signups.today} · الأسبوع ده {d.signups.week} · الإجمالي {d.signups.total}</>} />
            <Kpi icon={<KeyRound />} label="فعّلوا ودفعوا" value={`${conv}%`} sub={<>{d.signups.activated} من {d.signups.total} سجلوا</>} tone="tint" />
            <Kpi icon={<Banknote />} label="دخل الشهر ده" value={formatMoney(d.revenue.month)} sub={<>الشهر اللي فات {formatMoney(d.revenue.lastMonth)} · الإجمالي {formatMoney(d.revenue.total)}</>} />
            <Kpi icon={<Users />} label="اشتراكات شغالة" value={d.licenses.active} sub={d.licenses.expiring ? <span className="orange">{d.licenses.expiring} هيخلصوا خلال 30 يوم</span> : 'مفيش اشتراكات قربت تخلص'} />
            <Kpi icon={<Laptop />} label="أجهزة عليها البرنامج" value={d.devices.total} sub={<>في التجربة {d.devices.trial} · اتفتحت الأسبوع ده {d.devices.seenWeek}</>} />
          </div>

          <div className="own-grid">
            <section className="card own-card">
              <h3 className="own-h"><CalendarClock /> تكلم مين النهارده {calls > 0 && <span className="badge orange">{calls}</span>}</h3>
              {calls === 0 ? (
                <div className="muted small">مفيش حد محتاج تكلمه دلوقتي.</div>
              ) : (
                <div className="own-calls">
                  {d.newSignups.map((s) => (
                    <div key={s.id} className="own-call">
                      <span className="badge orange">سجل جديد</span>
                      <div className="own-call-t"><b>{s.name}</b> · {s.business}<div className="muted small">{ago(s.created_at)}</div></div>
                      <a className="btn sm" href={waUrl(s.phone, `أهلًا ${s.name}، معاك Eco System بخصوص التجربة المجانية. محتاج مساعدة في التسطيب؟`)} target="_blank" rel="noreferrer"><MessageCircle /> واتساب</a>
                    </div>
                  ))}
                  {d.endingTrials.map((t) => (
                    <div key={t.machine_id} className="own-call">
                      <span className="badge red">التجربة بتخلص</span>
                      <div className="own-call-t"><b>{t.company_name || 'محل من غير اسم'}</b> · باقي {t.days_left} يوم<div className="muted small num" dir="ltr">{t.machine_id}</div></div>
                      <button className="btn sm" onClick={() => nav('/licenses')}><KeyRound /> كود</button>
                    </div>
                  ))}
                  {d.expiringLicenses.map((l) => (
                    <div key={l.machine_id} className="own-call">
                      <span className="badge">تجديد</span>
                      <div className="own-call-t"><b>{l.customer}</b> · الاشتراك بيخلص {l.expires_at}<div className="muted small num" dir="ltr">{l.machine_id}</div></div>
                      {l.phone ? <a className="btn sm" href={waUrl(l.phone, `أهلًا، اشتراك Eco System عندكم بيخلص يوم ${l.expires_at}. تحب نجدده؟`)} target="_blank" rel="noreferrer"><MessageCircle /> واتساب</a> : <span />}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card own-card">
              <h3 className="own-h">التسجيلات والتفعيلات (آخر 12 أسبوع)</h3>
              <div className="own-chart" role="img" aria-label="رسمة التسجيلات والتفعيلات أسبوع بأسبوع">
                {d.weekly.map((w) => (
                  <div key={w.week} className="own-bar" title={`أسبوع ${shortDate(w.week)}: ${w.signups} تسجيل، ${w.activations} تفعيل`}>
                    <div className="own-bar-in">
                      <i className="s" style={{ height: `${(w.signups / maxWeek) * 100}%` }} />
                      <i className="a" style={{ height: `${(w.activations / maxWeek) * 100}%` }} />
                    </div>
                    <span className="own-bar-l">{shortDate(w.week)}</span>
                  </div>
                ))}
              </div>
              <div className="own-legend"><span><i className="s" /> تسجيلات</span><span><i className="a" /> تفعيلات</span></div>
            </section>
          </div>

          {d.byGovernorate.length > 0 && (
            <section className="card own-card" style={{ marginBottom: 14 }}>
              <h3 className="own-h">التسجيلات حسب المحافظة</h3>
              <div className="own-govs">
                {d.byGovernorate.map((g) => (
                  <div key={g.governorate} className="own-gov">
                    <span className="own-gov-n">{g.governorate}</span>
                    <span className="brand-bar" aria-hidden="true"><i style={{ width: `${(g.n / Math.max(...d.byGovernorate.map((x) => x.n))) * 100}%` }} /></span>
                    <span className="num">{g.n}</span>
                    <span className="muted small">{g.activated ? `فعّل ${g.activated}` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card own-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="own-h">بيانات التواصل اللي بتظهر للعملاء</h3>
              <button className="btn sm" onClick={() => setEditContact(true)}><Pencil /> تعديل</button>
            </div>
            <div className="own-contact">
              <span>تليفون: <bdi dir="ltr" className="bold">{c?.phone || '—'}</bdi></span>
              <span>واتساب: <bdi dir="ltr" className="bold">{c?.whatsapp || '—'}</bdi></span>
              <span>فيسبوك: {c?.facebook ? <a href={c.facebook} target="_blank" rel="noreferrer" dir="ltr">{c.facebook}</a> : '—'}</span>
              <span>يوتيوب: {c?.youtube ? <a href={c.youtube} target="_blank" rel="noreferrer" dir="ltr">{c.youtube}</a> : '—'}</span>
            </div>
          </section>

          <h3 className="own-h" style={{ marginTop: 18 }}><Laptop /> الأجهزة</h3>
          {d.installations.length === 0 ? (
            <div className="card"><Empty icon={<Laptop />} title="لسه مفيش أجهزة ظاهرة">الأجهزة بتظهر هنا أول ما برنامج الويندوز (من نسخة 1.0.13) يتفتح وهو على النت.</Empty></div>
          ) : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>المحل</th><th>الموبايل</th><th>رقم الجهاز</th><th>الحالة</th><th>آخر مرة اتفتح</th><th>النسخة</th><th>أول مرة</th></tr></thead>
                <tbody>
                  {d.installations.map((x) => (
                    <tr key={x.machine_id}>
                      <td data-label="المحل" className="bold">{x.customer || x.company_name || <span className="muted">من غير اسم</span>}{x.customer && x.company_name && x.company_name !== x.customer ? <div className="muted small">{x.company_name}</div> : null}</td>
                      <td data-label="الموبايل" className="num">{x.phone ? <a href={waUrl(x.phone)} target="_blank" rel="noreferrer">{x.phone}</a> : <span className="muted">—</span>}{x.governorate ? <div className="muted small">{x.governorate}</div> : null}</td>
                      <td data-label="رقم الجهاز" className="num" dir="ltr">{x.machine_id}</td>
                      <td data-label="الحالة"><DeviceStatus d={x} /></td>
                      <td data-label="آخر مرة اتفتح" className={Date.now() - new Date(x.last_seen).getTime() > 7 * 86400000 ? 'muted' : ''}>{ago(x.last_seen)}</td>
                      <td data-label="النسخة" className="num">{x.version ?? '—'}</td>
                      <td data-label="أول مرة" className="muted">{shortDate(x.first_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editContact && d && <ContactSheet contact={d.contact} onClose={() => setEditContact(false)} onSaved={() => void load()} />}
    </div>
  );
}
