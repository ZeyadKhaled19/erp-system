import { useEffect, useState } from 'react';
import { Banner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { readBrand, saveBrand, systemName, type Brand } from '../lib/brand';
import { setLocalIdentity } from '../lib/db';
import { getDeviceId, getDeviceName, type Session } from '../lib/session';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // اسم ولوجو الشركة: من آخر نسخة على الجهاز فورًا، وبعدين من الخادم
  const [brand, setBrand] = useState<Brand>(() => readBrand());
  useEffect(() => {
    document.title = `تسجيل الدخول — ${readBrand().company_name || 'الحسابات'}`;
    let alive = true;
    api<Brand>('/api/brand')
      .then((b) => {
        if (!alive) return;
        const next = { company_name: b.company_name ?? '', system_name: b.system_name ?? '', logo: b.logo ?? null };
        saveBrand(next);
        setBrand(next);
        document.title = `تسجيل الدخول — ${next.company_name || 'الحسابات'}`;
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
      setLocalIdentity(r.user.id);
      onLogin({ token: r.token, user: r.user, server_user_id: r.user.id });
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.network ? 'لا يوجد اتصال بالخادم. أول تسجيل دخول على هذا الجهاز يحتاج اتصالًا، وبعدها يعمل البرنامج دون إنترنت.' : e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        {brand.logo ? <img className="login-logo" src={brand.logo} alt={brand.company_name} /> : <img className="app-icon" src="/icon.svg" alt="" />}
        <div className="login-title">
          {brand.company_name && <div className="login-company">{brand.company_name}</div>}
          <h1>تسجيل الدخول</h1>
          <div className="muted">{systemName(brand)}</div>
        </div>
        {error && <Banner kind="err">{error}</Banner>}
        <div className="field">
          <label htmlFor="login-user">اسم المستخدم</label>
          <input id="login-user" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="login-pass">كلمة المرور</label>
          <input id="login-pass" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn primary lg block" disabled={busy || !username || !password}>
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
