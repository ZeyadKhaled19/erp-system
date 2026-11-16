import { Check, Copy, KeyRound, MessageCircle, Phone, PlaySquare, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { activateLicense, DEFAULT_CONTACT, waUrl, type LicenseState, type VendorContact } from '../lib/license';
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
