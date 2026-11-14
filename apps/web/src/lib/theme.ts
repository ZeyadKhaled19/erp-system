/**
 * المظهر لكل مستخدم: الوضع (فاتح/غامق/حسب الجهاز) ولون التمييز والخط والكثافة.
 * يُحفظ محليًا بمفتاح خاص بكل مستخدم، فلا تختلط اختيارات مستخدمين يتشاركون نفس الجهاز.
 * لا يمس قاعدة البيانات.
 */

export type ThemeMode = 'light' | 'navy' | 'amber' | 'teal' | 'paprika' | 'sage' | 'coral' | 'dark' | 'system';
/** أوضاع البالتات: كل ألوان النظام فيها من البالتة فقط، ولون التمييز يتبعها */
export const PALETTE_MODES = ['navy', 'amber', 'teal', 'paprika', 'sage', 'coral'] as const;
export const isPaletteMode = (m: string) => (PALETTE_MODES as readonly string[]).includes(m);
export type Accent = 'sky' | 'blue' | 'teal' | 'purple' | 'green' | 'orange' | 'pink';
export type Density = 'comfortable' | 'compact';
export type FontName = 'plex' | 'readex' | 'cairo' | 'tajawal' | 'almarai' | 'system';
export interface Appearance {
  theme: ThemeMode;
  accent: Accent;
  density: Density;
  font: FontName;
}

import { loadFont } from './fonts';

const LEGACY_KEY = 'erp.appearance';
const keyFor = (userId: string | null) => (userId ? `erp.appearance.${userId}` : 'erp.appearance.guest');
export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', accent: 'blue', density: 'comfortable', font: 'plex' };

export const FONTS: { id: FontName; label: string; family: string }[] = [
  { id: 'plex', label: 'IBM Plex Sans Arabic — رسمي وواضح (الافتراضي)', family: "'IBM Plex Sans Arabic'" },
  { id: 'readex', label: 'Readex Pro — عصري', family: "'Readex Pro'" },
  { id: 'cairo', label: 'Cairo — ودود', family: "'Cairo'" },
  { id: 'tajawal', label: 'Tajawal — خفيف', family: "'Tajawal'" },
  { id: 'almarai', label: 'Almarai — هادئ', family: "'Almarai'" },
  { id: 'system', label: 'خط الجهاز', family: "-apple-system, 'Segoe UI'" },
];

export const THEMES: { id: ThemeMode; label: string; desc: string }[] = [
  { id: 'light', label: 'فاتح', desc: 'خلفية هادئة وأسطح بيضاء' },
  { id: 'navy', label: 'كحلي عاجي', desc: 'كحلي وأزرق رمادي على خلفية عاجية' },
  { id: 'amber', label: 'بروسي برتقالي', desc: 'أزرق بروسي وبرتقالي على رمادي فاتح' },
  { id: 'teal', label: 'تركوازي غروب', desc: 'تركواز وذهبي وخوخي' },
  { id: 'paprika', label: 'فحمي بابريكا', desc: 'فحمي ورملي وبرتقالي بابريكا' },
  { id: 'sage', label: 'مريمي هادئ', desc: 'رمادي مخضر وتيل وفحمي مزرق' },
  { id: 'coral', label: 'استوائي مرجاني', desc: 'أزرق سماوي وتركواز ومشمشي ومرجاني' },
  { id: 'dark', label: 'غامق', desc: 'كحلي داكن مريح ليلًا' },
  { id: 'system', label: 'حسب الجهاز', desc: 'يتبع إعداد ويندوز أو الموبايل' },
];

export const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: 'sky', color: '#0284C7', label: 'أزرق سماوي' },
  { id: 'blue', color: '#2563EB', label: 'أزرق ملكي' },
  { id: 'teal', color: '#0F8A80', label: 'فيروزي' },
  { id: 'purple', color: '#7047E0', label: 'بنفسجي' },
  { id: 'green', color: '#16803A', label: 'أخضر' },
  { id: 'orange', color: '#D9530F', label: 'برتقالي' },
  { id: 'pink', color: '#CC2E6E', label: 'وردي' },
];

function currentUserId(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem('erp.session') ?? 'null');
    return s?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** تحويل القيم القديمة (زجاجي، دافئ، تلقائي، نيلي، جرافيت) إلى الخيارات الحالية */
function normalize(raw: any): Appearance {
  const a = { ...DEFAULT_APPEARANCE, ...(raw ?? {}) };
  if (a.theme === 'auto') a.theme = 'system';
  if (a.theme === 'sky' || a.theme === 'olive') a.theme = 'light';
  if (!['light', 'dark', 'system', ...PALETTE_MODES].includes(a.theme)) a.theme = 'light';
  if (!ACCENTS.some((x) => x.id === a.accent)) a.accent = a.accent === 'indigo' ? 'purple' : 'sky';
  if (!FONTS.some((x) => x.id === a.font)) a.font = 'plex';
  if (a.density !== 'compact') a.density = 'comfortable';
  return a;
}

export function loadAppearance(userId: string | null = currentUserId()): Appearance {
  try {
    const own = localStorage.getItem(keyFor(userId));
    if (own) return normalize(JSON.parse(own));
    // ترحيل الإعداد القديم المشترك للجهاز مرة واحدة لأول مستخدم يفتح
    const legacy = localStorage.getItem(LEGACY_KEY);
    return normalize(legacy ? JSON.parse(legacy) : null);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export function resolvedTheme(a: Appearance = loadAppearance()): Exclude<ThemeMode, 'system'> {
  return a.theme === 'system' ? (media?.matches ? 'dark' : 'light') : a.theme;
}

export function applyAppearance(a: Appearance = loadAppearance()) {
  const el = document.documentElement;
  const theme = resolvedTheme(a);
  el.dataset.theme = theme;
  el.dataset.mode = a.theme;
  el.dataset.accent = a.accent;
  el.dataset.density = a.density;
  el.dataset.font = a.font;
  loadFont(a.font);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0A1020' : theme === 'navy' ? '#1D2D44' : theme === 'amber' ? '#14213D' : theme === 'teal' ? '#264653' : theme === 'paprika' ? '#252422' : theme === 'sage' ? '#2F3E46' : theme === 'coral' ? '#004D65' : '#F4F6F9');
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(keyFor(currentUserId()), JSON.stringify(a));
  } catch {
    /* التخزين غير متاح: يُطبق للجلسة الحالية فقط */
  }
  applyAppearance(a);
  window.dispatchEvent(new CustomEvent('erp:appearance', { detail: a }));
}

media?.addEventListener?.('change', () => {
  if (loadAppearance().theme === 'system') applyAppearance();
});
