import { useState } from 'react';
import { Banner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { db, getMeta, setMeta } from '../lib/db';
import { getDeviceId, getDeviceName, type Session } from '../lib/session';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: Session['user'] }>('/api/auth/login', {
        body: { username, password, device_id: getDeviceId(), device_name: getDeviceName() },
      });
      // إذا دخل مستخدم مختلف على نفس الجهاز، تُحفظ عملياته المعلقة كما هي (تحمل هوية من أنشأها عند الرفع التالي)
      const last = await getMeta<string | null>('last_user_id', null);
      if (last && last !== r.user.id) {
        const pending = await db.outbox.where('status').equals('pending').count();
        if (pending) {
          setError(`يوجد ${pending} عملية للمستخدم السابق لم تُرفع بعد. سجّل الدخول بحسابه أولًا لرفعها عند توفر الاتصال.`);
          setBusy(false);
          return;
        }
      }
      await setMeta('last_user_id', r.user.id);
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
        <img className="app-icon" src="/icon.svg" alt="" />
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <h1 style={{ fontSize: 26, margin: '0 0 4px', fontWeight: 700 }}>تسجيل الدخول</h1>
          <div className="muted" style={{ fontSize: 15 }}>نظام الحسابات والمخازن</div>
        </div>
        {error && <Banner kind="err">{error}</Banner>}
        <div className="list" style={{ background: 'var(--bg)' }}>
          <div className="list-row" style={{ background: 'transparent' }}>
            <input className="input" style={{ background: 'transparent', padding: 0 }} placeholder="اسم المستخدم" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="list-row" style={{ background: 'transparent' }}>
            <input className="input" style={{ background: 'transparent', padding: 0 }} placeholder="كلمة المرور" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <button className="btn primary lg block" disabled={busy || !username || !password}>
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
