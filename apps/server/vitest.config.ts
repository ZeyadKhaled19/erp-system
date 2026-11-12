import { defineConfig } from 'vitest/config';

// كل ملف اختبار يفتح قاعدة بيانات PGlite جديدة ويطبق كل الترحيلات؛ عند تشغيل الملفات معًا
// على جهاز مشغول قد يتجاوز التجهيز 10 ثوانٍ، فنعطيه مهلة أطول (لا يغير أي اختبار).
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
