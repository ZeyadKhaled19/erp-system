/**
 * تراخيص برنامج الويندوز: تجربة مجانية 7 أيام، وبعدها البرنامج بيقفل لحد ما يتحط كود تفعيل.
 *
 * كود التفعيل = بيانات (رقم الجهاز + لحد إمتى + اسم العميل) موقّعة بمفتاح Ed25519.
 * - المفتاح السري (LICENSE_PRIVATE_KEY) موجود بس عند صاحب السيستم على Vercel، وبيطلع منه الأكواد.
 * - المفتاح العام تحت متخزن في البرنامج نفسه، وبيتأكد بيه إن الكود سليم ومتعمل للجهاز ده بالذات.
 * كده محدش يقدر يعمل كود من عنده، والكود ما ينفعش على جهاز تاني، والتفعيل بيشتغل من غير نت.
 */
import crypto from 'node:crypto';

export const LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAucKV2tQOZZWX0HIMw9uzHzJyH3cplixm/IzhPg+0diE=';
export const TRIAL_DAYS = 7;
const PREFIX = 'ECO1-';
const DAY = 86400000;

export interface LicensePayload {
  /** رقم الجهاز (XXXX-XXXX-XXXX-XXXX) */
  m: string;
  /** آخر يوم (YYYY-MM-DD)، أو null = مدى الحياة */
  e: string | null;
  /** اسم العميل */
  n: string;
  /** تاريخ الإصدار */
  t: string;
}

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const normalizeMachineId = (s: string) => String(s ?? '').toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{4})(?=.)/g, '$1-');
export const validMachineId = (s: string) => /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(normalizeMachineId(s));

function privateKey(pkcs8Base64: string) {
  return crypto.createPrivateKey({ key: Buffer.from(pkcs8Base64.trim(), 'base64'), format: 'der', type: 'pkcs8' });
}
function publicKey(spkiBase64: string) {
  return crypto.createPublicKey({ key: Buffer.from(spkiBase64.trim(), 'base64'), format: 'der', type: 'spki' });
}

/** يطلع كود تفعيل (على Vercel بس، بالمفتاح السري) */
export function signLicense(privateKeyBase64: string, p: LicensePayload): string {
  const body = Buffer.from(JSON.stringify({ m: normalizeMachineId(p.m), e: p.e, n: p.n, t: p.t }), 'utf8');
  const sig = crypto.sign(null, body, privateKey(privateKeyBase64));
  return PREFIX + b64u(body) + '.' + b64u(sig);
}

/** يتأكد من الكود: سليم، ومتوقّع بمفتاحنا، ومتعمل للجهاز ده. بيرجع البيانات أو رسالة الغلط */
export function verifyLicense(code: string, machineId: string, publicKeyBase64 = LICENSE_PUBLIC_KEY): { ok: true; payload: LicensePayload } | { ok: false; error: string } {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!c.startsWith(PREFIX) || !c.includes('.')) return { ok: false, error: 'الكود مش مكتوب صح. انسخه زي ما هو من الرسالة.' };
  const [bodyPart, sigPart] = c.slice(PREFIX.length).split('.');
  let body: Buffer;
  let payload: LicensePayload;
  try {
    body = fromB64u(bodyPart);
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { ok: false, error: 'الكود مش مكتوب صح. انسخه زي ما هو من الرسالة.' };
  }
  let good = false;
  try {
    good = crypto.verify(null, body, publicKey(publicKeyBase64), fromB64u(sigPart ?? ''));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, error: 'الكود ده مش سليم.' };
  if (normalizeMachineId(payload.m) !== normalizeMachineId(machineId)) return { ok: false, error: 'الكود ده متعمل لجهاز تاني. ابعت رقم الجهاز ده بالظبط.' };
  return { ok: true, payload };
}

/** اللي برنامج الويندوز بيعرفه عن الجهاز (بيبعته للخادم وقت التشغيل) */
export interface LicenseInput {
  machineId: string;
  /** أول يوم اتشغل فيه البرنامج على الجهاز ده (ISO) */
  trialStart: string;
  /** أحدث وقت شافه البرنامج (لو ساعة الجهاز اترجعت لورا) */
  lastSeen?: string | null;
  /** كود التفعيل المتحفظ، لو فيه */
  code?: string | null;
  /** جهاز كان شغال بالبرنامج قبل نظام التراخيص: مفتوح على طول */
  legacy?: boolean;
  /** بيانات التواصل مع صاحب السيستم (آخر نسخة جت من موقعه) */
  contact?: VendorContact | null;
  /** اتسجلت التجربة أونلاين برقم موبايل؟ (false = لازم يسجل الأول؛ مش موجودة = مش مطلوب) */
  registered?: boolean;
}

/** بيانات التواصل اللي بتظهر للعميل في شاشة التفعيل وصفحة التسجيل (صاحب السيستم بيعدلها من لوحته) */
export interface VendorContact {
  phone: string;
  whatsapp: string;
  facebook: string;
  youtube: string;
}
export const DEFAULT_CONTACT: VendorContact = { phone: '01279792522', whatsapp: '01279792522', facebook: '', youtube: '' };

export type LicenseStatus =
  | { status: 'active'; machineId: string; customer: string; expiresAt: string | null }
  | { status: 'trial'; machineId: string; daysLeft: number; endsAt: string }
  | { status: 'unregistered'; machineId: string; message: string }
  | { status: 'expired'; machineId: string; reason: 'trial' | 'license' | 'clock'; message: string };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function licenseStatus(input: LicenseInput, now = new Date(), publicKeyBase64 = LICENSE_PUBLIC_KEY): LicenseStatus {
  const machineId = normalizeMachineId(input.machineId);
  if (input.legacy) return { status: 'active', machineId, customer: '', expiresAt: null };
  // ساعة الجهاز مرجوعة لورا أكتر من يوم: غالبًا محاولة لإطالة التجربة
  if (input.lastSeen && now.getTime() < new Date(input.lastSeen).getTime() - DAY) {
    return { status: 'expired', machineId, reason: 'clock', message: 'تاريخ الجهاز متأخر عن آخر مرة اشتغل فيها البرنامج. ظبط التاريخ والساعة وافتح البرنامج تاني.' };
  }
  if (input.code) {
    const v = verifyLicense(input.code, machineId, publicKeyBase64);
    if (v.ok) {
      if (!v.payload.e || dayOf(now) <= v.payload.e) return { status: 'active', machineId, customer: v.payload.n, expiresAt: v.payload.e };
      return { status: 'expired', machineId, reason: 'license', message: `اشتراك البرنامج خلص يوم ${v.payload.e}. كلّمنا علشان تجدده.` };
    }
  }
  if (input.registered === false) {
    return { status: 'unregistered', machineId, message: 'علشان تبدأ التجربة المجانية (7 أيام) اكتب رقم موبايلك. أول مرة بس محتاج يكون الجهاز على النت.' };
  }
  const start = new Date(input.trialStart);
  const end = new Date(start.getTime() + TRIAL_DAYS * DAY);
  const left = Math.ceil((end.getTime() - now.getTime()) / DAY);
  if (left > 0) return { status: 'trial', machineId, daysLeft: Math.min(left, TRIAL_DAYS), endsAt: end.toISOString() };
  return { status: 'expired', machineId, reason: 'trial', message: 'الفترة التجريبية (7 أيام) خلصت. فعّل البرنامج علشان تكمل.' };
}

/** آخر يوم للاشتراك حسب المدة */
export function expiryFor(plan: 'month' | 'quarter' | 'year' | 'life' | 'days', days = 0, from = new Date()): string | null {
  if (plan === 'life') return null;
  const d = new Date(from);
  if (plan === 'month') d.setMonth(d.getMonth() + 1);
  else if (plan === 'quarter') d.setMonth(d.getMonth() + 3);
  else if (plan === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return dayOf(d);
}
