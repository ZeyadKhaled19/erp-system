import { EG_GOVERNORATES } from '@erp/shared';
import { Boxes, Calculator, Download, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { EcoCoverArt, EcoLogo } from '../components/EcoLogo';
import { ContactLinks } from '../components/LicenseGate';
import { useLicenseInfo } from '../lib/license';
import { Banner } from '../components/ui';

/**
 * صفحة «جرّب مجانًا 7 أيام» (من غير دخول، على موقع صاحب السيستم):
 * العميل يكتب بياناته ← تتسجل عند صاحب السيستم في صفحة التراخيص ← يظهرله زرار تحميل برنامج الويندوز.
 */
export function SignupPage() {
  const [f, setF] = useState({ name: '', phone: '', business: '', activity: '', governorate: '', city: '', website: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const lic = useLicenseInfo();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (f.name.trim().length < 2) return setErr('اكتب اسمك');
    if (!/^[0-9+\s-]{8,20}$/.test(f.phone.trim())) return setErr('رقم الموبايل مش مظبوط');
    if (f.business.trim().length < 2) return setErr('اكتب اسم النشاط أو المحل');
    if (!f.governorate) return setErr('اختار المحافظة');
    setBusy(true);
    try {
      const r = await fetch('/api/public/trial-signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? 'التسجيل ما نجحش، جرب تاني');
      setUrl(j.download_url);
    } catch (e2) {
      setErr((e2 as Error).message === 'Failed to fetch' ? 'مفيش اتصال بالإنترنت' : (e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lg-page">
      <aside className="lg-brand">
        <div className="lg-brand-in">
          <EcoLogo size={52} light className="lg-eco" />
          <h2 className="lg-tag">جرّب Eco System مجانًا 7 أيام</h2>
          <p className="lg-sub">برنامج ويندوز بيشتغل على جهاز محلك من غير نت: مبيعات ومشتريات ومخزون وحسابات وموظفين. من غير فيزا ومن غير أي التزام.</p>
          <ul className="lg-chips" aria-label="أقسام السيستم">
            <li><ShoppingCart aria-hidden="true" /> مبيعات</li>
            <li><Boxes aria-hidden="true" /> مخزون</li>
            <li><Calculator aria-hidden="true" /> حسابات</li>
          </ul>
          <EcoCoverArt className="lg-art" />
        </div>
        <div className="lg-brand-foot">© Eco System</div>
      </aside>

      <main className="lg-main">
        {url ? (
          <div className="lg-card">
            <EcoLogo size={40} className="lg-eco-mobile" />
            <div className="lg-head-t">
              <h1 style={{ margin: 0 }}>تمام، اتسجلت!</h1>
              <div className="lg-hint">نزّل البرنامج وسطّبه على جهاز المحل. التجربة 7 أيام بتبدأ من أول ما تفتحه.</div>
            </div>
            <a className="lg-submit" href={url} style={{ textDecoration: 'none' }}><Download aria-hidden="true" /> تحميل البرنامج للويندوز</a>
            <ol className="lic-steps">
              <li>افتح الملف اللي نزل وسطّب البرنامج، واكتب نفس رقم الموبايل أول ما يفتح (لازم يكون على النت أول مرة).</li>
              <li>ادخل بـ <b dir="ltr">admin</b> وكلمة السر <b dir="ltr">admin123</b>، وغيّرها من الإعدادات.</li>
              <li>لو احتجت مساعدة كلمنا، وهنتواصل معاك على رقمك.</li>
            </ol>
            <ContactLinks contact={lic?.contact} waText={`أهلًا، سجلت في تجربة Eco System باسم ${f.name}`} />
          </div>
        ) : (
          <form className="lg-card" onSubmit={submit} noValidate>
            <EcoLogo size={40} className="lg-eco-mobile" />
            <div className="lg-head-t">
              <h1 style={{ margin: 0 }}>جرّب مجانًا 7 أيام</h1>
              <div className="lg-hint">اكتب بياناتك وهيظهرلك زرار تحميل البرنامج على طول</div>
            </div>
            {err && <Banner kind="err">{err}</Banner>}
            <div className="lg-field"><label htmlFor="su-name">اسمك</label><div className="lg-input"><input id="su-name" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required /></div></div>
            <div className="lg-field"><label htmlFor="su-phone">رقم الموبايل (واتساب)</label><div className="lg-input"><input id="su-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" autoComplete="tel" required /></div></div>
            <div className="lg-field"><label htmlFor="su-biz">اسم المحل أو الشركة</label><div className="lg-input"><input id="su-biz" value={f.business} onChange={(e) => set('business', e.target.value)} autoComplete="organization" required /></div></div>
            <div className="lg-field"><label htmlFor="su-act">نوع النشاط <span className="muted">(اختياري)</span></label><div className="lg-input"><input id="su-act" value={f.activity} onChange={(e) => set('activity', e.target.value)} placeholder="مثلًا: قطع غيار، ملابس، سوبر ماركت" /></div></div>
            <div className="lg-field"><label htmlFor="su-gov">المحافظة</label>
              <select id="su-gov" className="select" value={f.governorate} onChange={(e) => set('governorate', e.target.value)} required>
                <option value="">— اختار المحافظة —</option>
                {EG_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="lg-field"><label htmlFor="su-city">المدينة أو المنطقة <span className="muted">(اختياري)</span></label><div className="lg-input"><input id="su-city" value={f.city} onChange={(e) => set('city', e.target.value)} /></div></div>
            {/* خانة مخفية للبرامج الآلية: الإنسان ما بيشوفهاش */}
            <input type="text" name="website" value={f.website} onChange={(e) => set('website', e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', clipPath: 'inset(50%)' }} />
            <button className="lg-submit" disabled={busy}>
              {busy ? <span className="lg-spin" aria-hidden="true" /> : <Download aria-hidden="true" />} سجّل ونزّل البرنامج
            </button>
            <div className="footnote" style={{ textAlign: 'center' }}>البرنامج بيبعتلنا لما يكون على النت: اسم المحل ورقم النسخة وحالة الاشتراك بس. فواتيرك وعملاءك وأرقامك بتفضل على جهازك.</div>
            <ContactLinks contact={lic?.contact} />
            <a href="/" className="lic-back">عندك حساب؟ تسجيل الدخول</a>
          </form>
        )}
      </main>
    </div>
  );
}
