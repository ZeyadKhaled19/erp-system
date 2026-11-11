/** المظهر لكل جهاز: الثيم واللون الأساسي والكثافة — يُطبق فورًا ويُحفظ محليًا */

export type ThemeName = 'light' | 'dark' | 'glass' | 'warm' | 'auto';
export type Accent = 'blue' | 'indigo' | 'purple' | 'pink' | 'orange' | 'green' | 'teal' | 'graphite';
export type Density = 'comfortable' | 'compact';
export interface Appearance {
  theme: ThemeName;
  accent: Accent;
  density: Density;
}

const KEY = 'erp.appearance';
const DEFAULT: Appearance = { theme: 'light', accent: 'blue', density: 'comfortable' };

export const THEMES: { id: ThemeName; label: string; preview: string; bars: string[] }[] = [
  { id: 'light', label: 'فاتح (آيباد)', preview: 'linear-gradient(135deg,#f2f2f7,#ffffff)', bars: ['#ffffff', '#ffffff'] },
  { id: 'dark', label: 'داكن', preview: 'linear-gradient(135deg,#000,#1c1c1e)', bars: ['#1c1c1e', '#2c2c2e'] },
  { id: 'glass', label: 'زجاجي ملون', preview: 'radial-gradient(circle at 80% 0%,#a0b8ff,transparent 60%),radial-gradient(circle at 0% 60%,#ffb3d6,transparent 60%),radial-gradient(circle at 60% 100%,#a6f0e0,transparent 60%),#eef0fb', bars: ['rgba(255,255,255,.65)', 'rgba(255,255,255,.5)'] },
  { id: 'warm', label: 'دافئ', preview: 'linear-gradient(135deg,#f5efe6,#fffdf9)', bars: ['#fffdf9', '#fbf6ee'] },
  { id: 'auto', label: 'تلقائي (حسب الجهاز)', preview: 'linear-gradient(90deg,#f2f2f7 50%,#1c1c1e 50%)', bars: ['#ffffff', '#2c2c2e'] },
];

export const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: 'blue', color: '#007AFF', label: 'أزرق' },
  { id: 'indigo', color: '#5856D6', label: 'نيلي' },
  { id: 'purple', color: '#AF52DE', label: 'بنفسجي' },
  { id: 'pink', color: '#FF2D55', label: 'وردي' },
  { id: 'orange', color: '#F57C00', label: 'برتقالي' },
  { id: 'green', color: '#1FA84A', label: 'أخضر' },
  { id: 'teal', color: '#0A9BB8', label: 'تركواز' },
  { id: 'graphite', color: '#3A3A3C', label: 'جرافيت' },
];

export function loadAppearance(): Appearance {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT;
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export function applyAppearance(a: Appearance = loadAppearance()) {
  const el = document.documentElement;
  const theme = a.theme === 'auto' ? (media?.matches ? 'dark' : 'light') : a.theme;
  el.dataset.theme = theme;
  el.dataset.accent = a.accent;
  el.dataset.density = a.density;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#000000' : theme === 'warm' ? '#f5efe6' : '#f2f2f7');
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
  applyAppearance(a);
  window.dispatchEvent(new CustomEvent('erp:appearance', { detail: a }));
}

media?.addEventListener?.('change', () => {
  if (loadAppearance().theme === 'auto') applyAppearance();
});
