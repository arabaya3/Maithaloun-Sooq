# سوق ميثلون

واجهة أولية إنتاجية لمتجر عربي لمنتجات التنظيف، مبنية بـ Next.js وTypeScript
وتعمل باتجاه RTL كتطبيق ويب تقدّمي.

## التشغيل المحلي

```bash
npx --yes pnpm@12.5.1 install
npx --yes pnpm@12.5.1 generate:icons
npx --yes pnpm@12.5.1 db:up
npx --yes pnpm@12.5.1 db:migrate
npx --yes pnpm@12.5.1 db:seed
npx --yes pnpm@12.5.1 dev
```

انسخ `.env.example` إلى `.env.local` واستبدل القيم المحلية قبل تشغيل قاعدة
البيانات. أمر `db:seed` مخصص لقاعدة `maithalun_dev` المحلية، وهو لا يستبدل
السجلات الموجودة. تستخدم الاختبارات قاعدة `maithalun_test` المنفصلة فقط.

افتح `http://localhost:3000`.

## البنية

- `src/app`: المسارات، البيانات الوصفية، الـ manifest والـ service worker.
- `src/features/catalog`: نموذج المنتجات وواجهة مستودع PostgreSQL.
- `src/features/cart`: مخزن سلة معزول وتخزين محلي متحقق منه.
- `src/features/orders`: التحقق من طلبات الدفع عند الاستلام وإنشاؤها بمعاملة.
- `src/server`: إعدادات الخادم ومخطط Drizzle واتصال PostgreSQL.
- `src/features/storefront`: واجهة المتجر والتصفية المحلية.
- `src/shared`: أدوات مشتركة لا تعتمد على ميزات المتجر.

السلة تحفظ معرّفات المنتجات والكميات فقط. الأسعار المعروضة تُحل دائماً من
الكتالوج المقدم من الخادم، ولا تُقرأ من التخزين المحلي.

## التحقق

```bash
npx --yes pnpm@12.5.1 format:check
npx --yes pnpm@12.5.1 lint
npx --yes pnpm@12.5.1 typecheck
npx --yes pnpm@12.5.1 test
npx --yes pnpm@12.5.1 db:test:up
npx --yes pnpm@12.5.1 test:db
npx --yes pnpm@12.5.1 test:e2e
npx --yes pnpm@12.5.1 build
```

يحافظ `db:stop` على بيانات قاعدة التطوير. لا تستخدم اختبارات قاعدة البيانات
قاعدة التطوير ولا أي خدمة بعيدة.

سياسة CSP مع nonce مؤجلة إلى مرحلة إضافة طبقة الخادم أو المصادقة، لتجنب سياسة
شكلية أو غير متوافقة مع مخرجات Next.js. رؤوس الحماية الآمنة وغير المتعارضة
مفعّلة حالياً في `next.config.ts`.
