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
  | { status: 'expired'; machineId: string; reason: 'trial' | 'license' | 'clock'; message: string };
export interface LicenseInfo {
  gated: boolean;
  vendor: boolean;
  canIssue: boolean;
  license: LicenseState | null;
}

/** رقم واتساب صاحب السيستم اللي العميل بيبعتله رقم الجهاز (فاضي = زرار واتساب مش بيظهر) */
export const VENDOR_WHATSAPP = '';

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

export async function activateLicense(code: string): Promise<LicenseState> {
  const r = await fetch('/api/license/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? 'التفعيل ما نجحش');
  await refreshLicense();
  return j.license;
}
