import { useEffect } from 'react';

/**
 * هوية العميل (اسم الشركة واسم النظام واللوجو) — كلها من الإعدادات، مش مكتوبة في الكود.
 * بتتحفظ نسخة منها على الجهاز علشان صفحة الدخول وعنوان المتصفح يظهروا صح حتى قبل الدخول ومن غير نت.
 */
export interface Brand {
  company_name: string;
  system_name: string;
  logo: string | null;
}

export const DEFAULT_SYSTEM_NAME = 'نظام إدارة الأعمال ERP';
const DEFAULT_TITLE = 'الحسابات';
const KEY = 'erp.brand.v1';
export const TITLE_SEP = ' — ';

export function readBrand(): Brand {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      return { company_name: String(v.company_name ?? ''), system_name: String(v.system_name ?? ''), logo: typeof v.logo === 'string' ? v.logo : null };
    }
  } catch {
    /* التخزين غير متاح */
  }
  return { company_name: '', system_name: '', logo: null };
}

/** اسم النظام اللي يظهر (اللي العميل كتبه، وإلا الافتراضي) */
export const systemName = (b: Pick<Brand, 'system_name'>) => b.system_name.trim() || DEFAULT_SYSTEM_NAME;
/** آخر جزء في عنوان المتصفح: اسم الشركة، وإلا «الحسابات» */
const titleSuffix = () => readBrand().company_name.trim() || DEFAULT_TITLE;

/** يضبط عنوان تبويب المتصفح: «اسم الشاشة — اسم الشركة» */
export function setDocTitle(title: string) {
  document.title = `${title}${TITLE_SEP}${titleSuffix()}`;
}

/** يشيل اسم الشركة من آخر العنوان (لأسماء تبويبات الشاشات) */
export function stripTitleSuffix(t: string) {
  const i = t.lastIndexOf(TITLE_SEP);
  return (i > 0 ? t.slice(0, i) : t).trim();
}

function applyFavicon(logo: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (!link.dataset.default) link.dataset.default = link.href;
  link.href = logo || link.dataset.default;
  link.type = logo ? (logo.match(/^data:([^;]+)/)?.[1] ?? 'image/png') : 'image/svg+xml';
}

export function saveBrand(b: Brand) {
  const prev = readBrand();
  if (prev.company_name === b.company_name && prev.system_name === b.system_name && prev.logo === b.logo) {
    applyFavicon(b.logo);
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* التخزين غير متاح: الهوية تظهر بعد الدخول بس */
  }
  applyFavicon(b.logo);
  // العنوان الحالي يتعدل للاسم الجديد
  const cur = stripTitleSuffix(document.title);
  if (cur && document.title.includes(TITLE_SEP)) setDocTitle(cur);
}

/** يحفظ هوية الشركة من الإعدادات كل ما تتغير */
export function useSyncBrand(settings: Record<string, any>) {
  const name = settings.company_name ?? '';
  const sys = settings.system_name ?? '';
  const logo = settings.print_logo ?? null;
  const loaded = settings.company_name !== undefined;
  useEffect(() => {
    if (loaded) saveBrand({ company_name: String(name), system_name: String(sys), logo });
  }, [loaded, name, sys, logo]);
}

/** أول ما الصفحة تفتح: الأيقونة والعنوان من آخر هوية محفوظة */
export function initBrand() {
  const b = readBrand();
  applyFavicon(b.logo);
  if (b.company_name) document.title = b.company_name;
}
