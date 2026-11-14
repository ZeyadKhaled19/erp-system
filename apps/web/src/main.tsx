// الخط الافتراضي بس، بالحروف العربية واللاتينية؛ باقي الخطوط بتتحمل عند اختيارها (lib/fonts.ts)
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-700.css';
import './styles.css';
import './theme-pro.css';
import './motorco.css';
import './motorco-screens.css';
import { applyAppearance } from './lib/theme';

// تطبيق المظهر المحفوظ قبل أول رسم لتجنب وميض الثيم
applyAppearance();
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
// النسخة الحادة آخر ملف تصميم (بعد sections.css اللي بيتحمّل من داخل App)
import './sharp.css';
import { UiProvider } from './components/ui';
import { initBrand } from './lib/brand';

// أيقونة وعنوان المتصفح من آخر هوية شركة محفوظة على الجهاز
initBrand();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);

// تسجيل Service Worker لتشغيل التطبيق دون اتصال وتثبيته كـ PWA
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        window.dispatchEvent(new CustomEvent('erp:update-ready', { detail: update }));
      },
    });
  });
}
