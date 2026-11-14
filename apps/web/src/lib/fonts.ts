/**
 * تحميل الخطوط عند الحاجة.
 * الخط الافتراضي (IBM Plex Sans Arabic) محمّل ثابت في main.tsx، وبالحروف العربية واللاتينية بس.
 * باقي الخطوط بتتحمل أول ما المستخدم يختارها (أو يفتح شاشة المظهر)، فمش بتتنزل مع كل تثبيت
 * ولا بتتخزن مسبقًا على كل جهاز. بعد أول تحميل بتتخزن في كاش الـ Service Worker وتشتغل من غير نت.
 */
import type { FontName } from './theme';

const loaders: Partial<Record<FontName, () => Promise<unknown>>> = {
  readex: () => Promise.all([
    import('@fontsource/readex-pro/arabic-400.css'), import('@fontsource/readex-pro/latin-400.css'),
    import('@fontsource/readex-pro/arabic-500.css'), import('@fontsource/readex-pro/latin-500.css'),
    import('@fontsource/readex-pro/arabic-600.css'), import('@fontsource/readex-pro/latin-600.css'),
    import('@fontsource/readex-pro/arabic-700.css'), import('@fontsource/readex-pro/latin-700.css'),
  ]),
  cairo: () => Promise.all([
    import('@fontsource/cairo/arabic-400.css'), import('@fontsource/cairo/latin-400.css'),
    import('@fontsource/cairo/arabic-600.css'), import('@fontsource/cairo/latin-600.css'),
    import('@fontsource/cairo/arabic-700.css'), import('@fontsource/cairo/latin-700.css'),
  ]),
  tajawal: () => Promise.all([
    import('@fontsource/tajawal/arabic-400.css'), import('@fontsource/tajawal/latin-400.css'),
    import('@fontsource/tajawal/arabic-500.css'), import('@fontsource/tajawal/latin-500.css'),
    import('@fontsource/tajawal/arabic-700.css'), import('@fontsource/tajawal/latin-700.css'),
  ]),
  almarai: () => Promise.all([
    import('@fontsource/almarai/arabic-400.css'), import('@fontsource/almarai/latin-400.css'),
    import('@fontsource/almarai/arabic-700.css'), import('@fontsource/almarai/latin-700.css'),
  ]),
};

const loaded = new Set<FontName>(['plex', 'system']);

/** يحمّل خطًا واحدًا لو مش محمّل. لو فشل (مثلًا من غير نت لأول مرة) الواجهة بتكمل بالخط الاحتياطي. */
export function loadFont(font: FontName): void {
  if (loaded.has(font)) return;
  const load = loaders[font];
  if (!load) return;
  loaded.add(font);
  load().catch(() => loaded.delete(font));
}

/** لشاشة المظهر: كل الخطوط عشان المعاينة تظهر بشكلها الحقيقي */
export function loadAllFonts(): void {
  (Object.keys(loaders) as FontName[]).forEach(loadFont);
}
