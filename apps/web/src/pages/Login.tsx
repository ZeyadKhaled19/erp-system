import { Boxes, Calculator, Eye, EyeOff, Lock, LogIn, ShoppingCart, Store, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EcoCoverArt, EcoLogo, EcoMark } from '../components/EcoLogo';
import { useLicenseInfo } from '../lib/license';
import { Banner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { DEFAULT_SYSTEM_NAME, readBrand, saveBrand, systemName, type Brand } from '../lib/brand';
import '../login.css';
import { setLocalIdentity } from '../lib/db';
import { getDeviceId, getDeviceName, type Session } from '../lib/session';

// «تذكر اسم المستخدم»: بيتحفظ على الجهاز ده بس (من غير كلمة السر)
const REMEMBER_KEY = 'erp.login.remember.v1';
function readRemembered(): { remember: boolean; username: string } {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? 'null');
    if (v && typeof v === 'object') return { remember: v.remember !== false, username: typeof v.username === 'string' ? v.username : '' };
  } catch {
    /* التخزين غير متاح */
  }
  return { remember: true, username: '' };
}
function writeRemembered(remember: boolean, username: string) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ remember, username: remember ? username : '' }));
  } catch {
    /* التخزين غير متاح: مش هيفتكر الاسم */
  }
}

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [saved] = useState(readRemembered);
  const [username, setUsername] = useState(saved.username);
  const [remember, setRemember] = useState(saved.remember);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // اسم ولوجو الشركة: من آخر نسخة على الجهاز فورًا، وبعدين من الخادم
  const [brand, setBrand] = useState<Brand>(() => readBrand());
  useEffect(() => {
    document.title = `تسجيل الدخول — ${readBrand().company_name || 'Eco System'}`;
    let alive = true;
    api<Brand>('/api/brand')
      .then((b) => {
        if (!alive) return;
        const next = { company_name: b.company_name ?? '', system_name: b.system_name ?? '', logo: b.logo ?? null };
        saveBrand(next);
        setBrand(next);
        document.title = `تسجيل الدخول — ${next.company_name || 'Eco System'}`;
      })
      .catch(() => { /* من غير نت: تفضل آخر نسخة محفوظة */ });
    return () => { alive = false; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: Session['user'] }>('/api/auth/login', {
        body: { username, password, device_id: getDeviceId(), device_name: getDeviceName() },
      });
      // كل حساب يفتح قاعدة بياناته وطابوره المحليين؛ عمليات الحسابات الأخرى تبقى معزولة.
      writeRemembered(remember, username.trim());
      setLocalIdentity(r.user.id);
      onLogin({ token: r.token, user: r.user, server_user_id: r.user.id });
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.network ? 'لا يوجد اتصال بالخادم. أول تسجيل دخول على هذا الجهاز يحتاج اتصالًا، وبعدها يعمل البرنامج دون إنترنت.' : e2.message);
    } finally {
      setBusy(false);
    }
  };

  const custom = systemName(brand) !== DEFAULT_SYSTEM_NAME ? systemName(brand) : '';
  const lic = useLicenseInfo();
  return (
    <div className="lg-page">
      {/* لوحة Eco System */}
      <aside className="lg-brand" aria-hidden="false">
        <div className="lg-brand-in">
          <EcoLogo size={52} light className="lg-eco" />
          <h2 className="lg-tag">نظام واحد لإدارة محلك كله</h2>
          <p className="lg-sub">مبيعات ومشتريات ومخزون وحسابات وموظفين — بيشتغل حتى من غير نت.</p>
          <ul className="lg-chips" aria-label="أقسام السيستم">
            <li><ShoppingCart aria-hidden="true" /> مبيعات</li>
            <li><Boxes aria-hidden="true" /> مخزون</li>
            <li><Calculator aria-hidden="true" /> حسابات</li>
          </ul>
          <EcoCoverArt className="lg-art" />
        </div>
        <div className="lg-brand-foot">© Eco System</div>
      </aside>

      {/* تسجيل الدخول */}
      <main className="lg-main">
        <form className="lg-card" onSubmit={submit}>
          <EcoLogo size={40} className="lg-eco-mobile" />
          <div className="lg-head">
            {brand.logo ? (
              <img className="lg-company-logo" src={brand.logo} alt={brand.company_name} />
            ) : (
              <span className="lg-company-mark" aria-hidden="true"><Store /></span>
            )}
            <div className="lg-head-t">
              {brand.company_name && <div className="lg-company">{brand.company_name}</div>}
              <h1>تسجيل الدخول</h1>
              <div className="lg-hint">{custom ? custom : 'أهلًا بيك، ادخل ببيانات حسابك'}</div>
            </div>
          </div>
          {error && <Banner kind="err">{error}</Banner>}
          <div className="lg-field">
            <label htmlFor="login-user">اسم المستخدم</label>
            <div className="lg-input">
              <User aria-hidden="true" />
              <input id="login-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!saved.username} required placeholder="مثلًا: admin" dir="auto" />
            </div>
          </div>
          <div className="lg-field">
            <label htmlFor="login-pass">كلمة المرور</label>
            <div className="lg-input">
              <Lock aria-hidden="true" />
              <input id="login-pass" type={showPass ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!saved.username} required placeholder="••••••••" dir="ltr" />
              <button type="button" className="lg-eye" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} title={showPass ? 'إخفاء' : 'إظهار'}>
                {showPass ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>
        <label className="login-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
              // لو اتشال الصح: نمسح الاسم المحفوظ فورًا
              if (!e.target.checked) writeRemembered(false, '');
            }}
          />
          تذكر اسم المستخدم على الجهاز ده
        </label>
          <button className="lg-submit" disabled={busy || !username || !password}>
            {busy ? <span className="lg-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>
        {lic?.vendor && <a href="/signup" className="lic-try">مش عندك حساب؟ <b>جرّب Eco System مجانًا 7 أيام</b></a>}
        <div className="lg-foot">
          <EcoMark size={16} /> <bdi>Eco System</bdi>
        </div>
      </main>
    </div>
  );
}
