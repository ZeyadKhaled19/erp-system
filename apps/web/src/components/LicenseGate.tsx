import { EG_GOVERNORATES } from '@erp/shared';
import { Check, Copy, KeyRound, MessageCircle, Phone, PlaySquare, Rocket, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { activateLicense, DEFAULT_CONTACT, registerTrial, applyResetCode, waUrl, type LicenseState, type VendorContact } from '../lib/license';
import { EcoLogo } from './EcoLogo';
import { Banner, Sheet } from './ui';

/** أزرار التواصل مع صاحب السيستم: اتصال، واتساب، فيسبوك، يوتيوب (اللي متسجل بس بيظهر) */
export function ContactLinks({ contact, waText = '' }: { contact?: VendorContact | null; waText?: string }) {
  const c = { ...DEFAULT_CONTACT, ...(contact ?? {}) };
  if (!c.phone && !c.whatsapp && !c.facebook && !c.youtube) return null;
  return (
    <div className="lic-contact">
      {c.whatsapp && <a className="btn sm" href={waUrl(c.whatsapp, waText)} target="_blank" rel="noreferrer"><MessageCircle /> واتساب</a>}
      {c.phone && <a className="btn sm" href={`tel:${c.phone.replace(/\s+/g, '')}`}><Phone /> <bdi dir="ltr">{c.phone}</bdi></a>}
      {c.facebook && <a className="btn sm" href={c.facebook} target="_blank" rel="noreferrer"><ThumbsUp /> فيسبوك</a>}
      {c.youtube && <a className="btn sm" href={c.youtube} target="_blank" rel="noreferrer"><PlaySquare /> يوتيوب</a>}
    </div>
  );
}

/** رقم الجهاز وزرار نسخه (والعميل بيبعته لصاحب السيستم علشان يطلعله كود) */
function MachineId({ id, contact }: { id: string; contact?: VendorContact | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* المتصفح رفض: الرقم ظاهر ويتنسخ باليد */ }
  };
  const num = (contact ?? DEFAULT_CONTACT).whatsapp;
  const wa = num ? waUrl(num, `عايز أفعّل Eco System. رقم الجهاز: ${id}`) : '';
  return (
    <div className="lic-machine">
      <div className="lic-machine-l">رقم الجهاز</div>
      <div className="lic-machine-row">
        <bdi className="lic-machine-id">{id}</bdi>
        <button type="button" className="btn sm" onClick={copy}>{copied ? <><Check /> اتنسخ</> : <><Copy /> نسخ</>}</button>
        {wa && <a className="btn sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle /> ابعته واتساب</a>}
      </div>
    </div>
  );
}

/** خانة كود التفعيل */
function ActivateForm({ onDone }: { onDone?: (s: LicenseState) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null);
    if (!code.trim()) return setErr('الصق كود التفعيل الأول');
    setBusy(true);
    try {
      const s = await activateLicense(code.trim());
      onDone?.(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      {err && <Banner kind="err">{err}</Banner>}
      <label className="lic-code-l" htmlFor="lic-code">كود التفعيل</label>
      <textarea id="lic-code" className="textarea num lic-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ECO1-…" spellCheck={false} />
      <button type="button" className="lg-submit" disabled={busy} onClick={go}>
        {busy ? <span className="lg-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />} تفعيل
      </button>
    </div>
  );
}

/** شاشة القفل: بعد ما التجربة أو الاشتراك يخلص (أو لو ساعة الجهاز اترجعت لورا) */
export function LockScreen({ license, contact }: { license: Extract<LicenseState, { status: 'expired' }>; contact?: VendorContact | null }) {
  return (
    <div className="lic-page">
      <div className="lg-card lic-card">
        <EcoLogo size={40} className="lic-logo" />
        <h1 className="lic-title">{license.reason === 'license' ? 'الاشتراك خلص' : license.reason === 'clock' ? 'تاريخ الجهاز مش مظبوط' : 'الفترة التجريبية خلصت'}</h1>
        <p className="lic-msg">{license.message}</p>
        {license.reason !== 'clock' && (
          <>
            <ol className="lic-steps">
              <li>ابعتلنا <b>رقم الجهاز</b> اللي تحت.</li>
              <li>هنبعتلك <b>كود التفعيل</b> بعد الدفع.</li>
              <li>الصق الكود هنا ودوس «تفعيل». بياناتك كلها زي ما هي.</li>
            </ol>
            <MachineId id={license.machineId} contact={contact} />
            <ActivateForm onDone={() => window.location.reload()} />
          </>
        )}
        <div className="lic-contact-h">للتواصل معانا</div>
        <ContactLinks contact={contact} waText={`استفسار عن Eco System. رقم الجهاز: ${license.machineId}`} />
      </div>
    </div>
  );
}

/** أول مرة البرنامج يتفتح: يكتب رقم موبايله علشان التجربة تبدأ (تجربة واحدة لكل رقم) */
export function RegisterScreen({ license, contact }: { license: Extract<LicenseState, { status: 'unregistered' }>; contact?: VendorContact | null }) {
  const [f, setF] = useState({ phone: '', business: '', governorate: '', username: '', password: '', password2: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'trial' | 'code'>('trial');
  const go = async () => {
    setErr(null);
    if (!/^0?1[0125][0-9]{8}$/.test(f.phone.replace(/[^0-9]/g, '').replace(/^20/, '0'))) return setErr('اكتب رقم موبايلك صح، زي 01xxxxxxxxx');
    if (f.business.trim().length < 2) return setErr('اكتب اسم المحل');
    if (!f.governorate) return setErr('اختار المحافظة');
    if (f.username.trim().length < 2 || /\s/.test(f.username.trim())) return setErr('اكتب اسم المستخدم (حرفين على الأقل ومن غير مسافات)');
    if (f.password.trim().length < 8) return setErr('اختار كلمة سر للدخول: 8 حروف أو أرقام على الأقل');
    if (f.password !== f.password2) return setErr('كلمتين السر مش زي بعض');
    setBusy(true);
    try {
      await registerTrial({ phone: f.phone, business: f.business, governorate: f.governorate, admin_username: f.username.trim(), admin_password: f.password });
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lic-page">
      <div className="lg-card lic-card">
        <EcoLogo size={40} className="lic-logo" />
        <h1 className="lic-title">أهلًا بيك في Eco System</h1>
        <p className="lic-msg">{mode === 'trial' ? license.message : 'لو اشتريت البرنامج، ابعتلنا رقم الجهاز وهنبعتلك كود التفعيل.'}</p>
        {mode === 'trial' ? (
          <div className="stack">
            {err && <Banner kind="err">{err}</Banner>}
            <div className="lg-field"><label htmlFor="rg-phone">رقم الموبايل (واتساب)</label><div className="lg-input"><input id="rg-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" autoFocus /></div></div>
            <div className="lg-field"><label htmlFor="rg-biz">اسم المحل أو الشركة</label><div className="lg-input"><input id="rg-biz" value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })} /></div></div>
            <div className="lg-field"><label htmlFor="rg-gov">المحافظة</label>
              <select id="rg-gov" className="select" value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })}>
                <option value="">— اختار المحافظة —</option>
                {EG_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="lic-pw-h">بيانات الدخول بتاعتك (محدش غيرك هيعرفها)</div>
            <div className="lg-field"><label htmlFor="rg-user">اسم المستخدم</label><div className="lg-input"><input id="rg-user" autoComplete="username" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="مثلًا: ahmed" /></div></div>
            <div className="grid grid-2">
              <div className="lg-field"><label htmlFor="rg-pw">كلمة السر</label><div className="lg-input"><input id="rg-pw" type="password" autoComplete="new-password" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="8 حروف أو أرقام" /></div></div>
              <div className="lg-field"><label htmlFor="rg-pw2">اكتبها تاني</label><div className="lg-input"><input id="rg-pw2" type="password" autoComplete="new-password" dir="ltr" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} /></div></div>
            </div>
            <button type="button" className="lg-submit" disabled={busy} onClick={go}>
              {busy ? <span className="lg-spin" aria-hidden="true" /> : <Rocket aria-hidden="true" />} ابدأ التجربة المجانية
            </button>
            <div className="footnote" style={{ textAlign: 'center' }}>تجربة واحدة لكل رقم موبايل. البرنامج بيبعتلنا اسم المحل ورقم النسخة وحالة الاشتراك بس، وفواتيرك وعملاءك بيفضلوا على جهازك.</div>
            <button type="button" className="lic-back btn plain" onClick={() => setMode('code')}>عندي كود تفعيل</button>
          </div>
        ) : (
          <>
            <MachineId id={license.machineId} contact={contact} />
            <ActivateForm onDone={() => window.location.reload()} />
            <button type="button" className="lic-back btn plain" onClick={() => setMode('trial')}>رجوع للتجربة المجانية</button>
          </>
        )}
        <div className="lic-contact-h">للتواصل معانا</div>
        <ContactLinks contact={contact} waText={`استفسار عن Eco System. رقم الجهاز: ${license.machineId}`} />
      </div>
    </div>
  );
}

/** شريط صغير وقت التجربة: باقي كام يوم، وزرار تفعيل */
export function TrialPill({ license, contact }: { license: Extract<LicenseState, { status: 'trial' }>; contact?: VendorContact | null }) {
  const [open, setOpen] = useState(false);
  const urgent = license.daysLeft <= 2;
  return (
    <>
      <button type="button" className={`lic-pill ${urgent ? 'urgent' : ''}`} onClick={() => setOpen(true)} title="فعّل البرنامج">
        <KeyRound aria-hidden="true" /> نسخة تجريبية · {license.daysLeft === 1 ? 'آخر يوم' : `باقي ${license.daysLeft} أيام`}
        <span className="lic-pill-a">تفعيل</span>
      </button>
      {open && (
        <Sheet title="تفعيل البرنامج" onClose={() => setOpen(false)}>
          <div className="stack">
            <div className="footnote">النسخة التجريبية شغالة {license.daysLeft === 1 ? 'لآخر النهارده' : `${license.daysLeft} أيام كمان`}. علشان تكمل بعدها: ابعتلنا رقم الجهاز، وهنبعتلك كود التفعيل.</div>
            <MachineId id={license.machineId} contact={contact} />
            <ActivateForm onDone={() => window.location.reload()} />
            <div className="lic-contact-h">للتواصل معانا</div>
            <ContactLinks contact={contact} waText={`استفسار عن Eco System. رقم الجهاز: ${license.machineId}`} />
          </div>
        </Sheet>
      )}
    </>
  );
}

/** «نسيت اليوزر أو الباسورد؟»: العميل يبعت رقم الجهاز، وصاحب السيستم يبعتله كود استرجاع */
export function ForgotPasswordSheet({ machineId, contact, onClose, onDone }: { machineId: string; contact?: VendorContact | null; onClose: () => void; onDone: (username: string) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null);
    if (!code.trim()) return setErr('الصق كود الاسترجاع الأول');
    setBusy(true);
    try {
      const u = await applyResetCode(code.trim());
      onDone(u);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="نسيت اسم المستخدم أو كلمة السر؟" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy} onClick={go}><KeyRound /> استخدم الكود</button></>}>
      <div className="stack">
        <ol className="lic-steps">
          <li>ابعتلنا <b>رقم الجهاز</b> اللي تحت.</li>
          <li>هنبعتلك <b>كود استرجاع</b> ومعاه اسم المستخدم وكلمة السر الجداد.</li>
          <li>الصق الكود هنا ودوس «استخدم الكود»، وبعدها ادخل بالبيانات الجديدة.</li>
        </ol>
        <MachineId id={machineId} contact={contact} />
        {err && <Banner kind="err">{err}</Banner>}
        <textarea className="textarea num lic-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ECOR-…" spellCheck={false} aria-label="كود الاسترجاع" />
        <ContactLinks contact={contact} waText={`نسيت بيانات الدخول في Eco System. رقم الجهاز: ${machineId}`} />
      </div>
    </Sheet>
  );
}
