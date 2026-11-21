// حزم NestJS الاختيارية: Nest بيحاول يحمّلها وقت التشغيل لو مسطبة بس (microservices، websockets، class-validator…).
// مش بنستخدمها، فالـ bundler (esbuild) يسيبها برّه الحزمة بدل ما يفشل وهو بيدوّر عليها.
// بيستخدمها: scripts/build-vercel.mjs و desktop/scripts/prepare.mjs
export const NEST_OPTIONAL = [
  '@nestjs/microservices',
  '@nestjs/microservices/*',
  '@nestjs/websockets',
  '@nestjs/websockets/*',
  '@nestjs/platform-express',
  '@fastify/view',
  '@fastify/multipart',
  'class-validator',
  'class-transformer',
];
