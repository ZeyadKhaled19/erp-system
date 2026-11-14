import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// اسم التطبيق لما يتثبت على الجهاز: يتغير لكل عميل من متغيرات Vercel (APP_NAME و APP_SHORT_NAME) من غير تعديل في الكود
const APP_NAME = process.env.APP_NAME || 'نظام الحسابات والمخازن';
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || process.env.APP_NAME || 'الحسابات';

export default defineConfig({
  plugins: [
    react(),
    { name: 'app-name-html', transformIndexHtml: (html: string) => html.replace(/<title>[^<]*<\/title>/, `<title>${APP_NAME.replace(/[<&>]/g, '')}</title>`) },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: 'نظام ERP عربي للحسابات والمخازن والمبيعات يعمل دون اتصال',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F2F2F7',
        theme_color: '#F2F2F7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // كل ملفات الواجهة والخط الافتراضي تُخزن مسبقًا ليفتح التطبيق دون اتصال.
        // الخطوط الاختيارية مش بتتخزن مسبقًا (كانت بتنزّل ~800KB على كل جهاز)؛ بتتخزن أول ما تتحمل.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/readex-pro-*.woff2', '**/cairo-*.woff2', '**/tajawal-*.woff2', '**/almarai-*.woff2'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'erp-fonts', expiration: { maxEntries: 60, maxAgeSeconds: 365 * 24 * 3600 } },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        app: 'index.html',
        designPreview: 'design-preview.html',
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
  preview: {
    port: 4173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
