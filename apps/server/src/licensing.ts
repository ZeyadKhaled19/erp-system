import type { LicenseInput } from './license';

// المسارات والمنطق اتنقلوا لـ modules/licensing (NestJS). هنا الأنواع والأدوات المشتركة بس.

/** القفل في برنامج الويندوز: البرنامج بيدّي الخادم بيانات الجهاز، والخادم بيقرر مفتوح ولا مقفول */
export interface LicenseGate {
  get(): LicenseInput;
  /** اتحط كود صحيح: البرنامج بيحفظه */
  activate(code: string): void;
  /** التجربة اتسجلت أونلاين برقم الموبايل (أو اتعرف تاريخ أقدم): البرنامج بيحفظ */
  register?(trialStart: string, phone: string): void;
}

/** رقم الموبايل بشكل واحد: 01xxxxxxxxx */
export const normalizePhone = (s: string) => {
  let d = String(s ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^0-9]/g, '');
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  return d;
};
/** أقدم تاريخ صالح من القائمة */
export const minIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
