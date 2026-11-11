/** الجلسة تُحفظ محليًا ليبقى المستخدم داخل البرنامج دون اتصال */

const safe = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

export function getDeviceId(): string {
  let id = safe.get('erp.device_id');
  if (!id) {
    id = crypto.randomUUID();
    safe.set('erp.device_id', id);
  }
  return id;
}

export function getDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|Mac/.test(ua) ? 'Apple' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os} ${br}`.trim();
}

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role_id: string;
  role_name: string;
  permissions: string[];
  limits?: { max_discount_bp?: number; max_discount_amount?: number };
  warehouse_ids?: string[] | null;
  cashbox_ids?: string[] | null;
}

export interface Session {
  token: string;
  user: SessionUser;
  server_user_id: string;
}

export function loadSession(): Session | null {
  const raw = safe.get('erp.session');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  safe.set('erp.session', s ? JSON.stringify(s) : null);
}
