import { useEffect, useState } from 'react';

/**
 * حالة الترخيص من الخادم:
 * - برنامج الويندوز (gated): تجربة 7 أيام، وبعدها قفل لحد كود التفعيل.
 * - موقع صاحب السيستم (vendor): فيه صفحة «جرّب مجانًا» وصفحة التراخيص.
 * - غير كده (زي الموقع العادي): مفيش أي قفل.
 */
export type LicenseState =
  | { status: 'active'; machineId: string; customer: string; expiresAt: string | null }
  | { status: 'trial'; machineId: string; daysLeft: number; endsAt: string }
  | { status: 'unregistered'; machineId: string; message: string }
  | { status: 'expired'; machineId: string; reason: 'trial' | 'license' | 'clock'; message: string };
/** بيانات التواصل مع صاحب السيستم (بيعدلها من «لوحة صاحب السيستم») */
export interface VendorContact {
  phone: string;
  whatsapp: string;
  facebook: string;
  youtube: string;
}
export const DEFAULT_CONTACT: VendorContact = { phone: '01279792522', whatsapp: '01279792522', facebook: '', youtube: '' };

export interface LicenseInfo {
  gated: boolean;
  vendor: boolean;
  canIssue: boolean;
  license: LicenseState | null;
  contact?: VendorContact;
}

/** لينك واتساب من رقم مصري زي 01xxxxxxxxx */
export function waUrl(phone: string, text = ''): string {
  const digits = phone.replace(/[^0-9]/g, '').replace(/^00/, '').replace(/^0(?=1)/, '20');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

let cache: LicenseInfo | null = null;
let inflight: Promise<LicenseInfo | null> | null = null;
const listeners = new Set<(i: LicenseInfo | null) => void>();

/** بيسأل الخادم (من غير توكن). لو مفيش نت بيرجع آخر حالة معروفة */
export function refreshLicense(): Promise<LicenseInfo | null> {
  inflight ??= fetch('/api/license', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: LicenseInfo | null) => {
      if (j) {
        cache = j;
        listeners.forEach((l) => l(j));
      }
      return cache;
    })
    .catch(() => cache)
    .finally(() => { inflight = null; });
  return inflight;
}

export function useLicenseInfo(): LicenseInfo | null {
  const [info, setInfo] = useState<LicenseInfo | null>(cache);
  useEffect(() => {
    listeners.add(setInfo);
    if (!cache) void refreshLicense();
    // أي طلب رجع «البرنامج مقفول» (402): نحدّث الحالة فورًا
    const h = () => void refreshLicense();
    window.addEventListener('erp:license', h);
    return () => {
      listeners.delete(setInfo);
      window.removeEventListener('erp:license', h);
    };
  }, []);
  return info;
}

/** تسجيل التجربة أول مرة برقم الموبايل (برنامج الويندوز بيكلم موقع صاحب السيستم) */
export async function registerTrial(body: { phone: string; business: string; governorate: string; admin_password?: string }): Promise<LicenseState> {
  const r = await fetch('/api/license/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? 'التسجيل ما نجحش');
  await refreshLicense();
  return j.license;
}

export async function activateLicense(code: string): Promise<LicenseState> {
  const r = await fetch('/api/license/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? 'التفعيل ما نجحش');
  await refreshLicense();
  return j.license;
}
