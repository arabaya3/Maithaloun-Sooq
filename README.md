# سوق ميثلون

واجهة أولية إنتاجية لمتجر عربي لمنتجات التنظيف، مبنية بـ Next.js وTypeScript
وتعمل باتجاه RTL كتطبيق ويب تقدّمي.

## التشغيل المحلي

```bash
npx --yes pnpm@12.5.1 install
npx --yes pnpm@12.5.1 generate:icons
npx --yes pnpm@12.5.1 dev
```

افتح `http://localhost:3000`.

## البنية

- `src/app`: المسارات، البيانات الوصفية، الـ manifest والـ service worker.
- `src/features/catalog`: نموذج المنتجات وواجهة المستودع والتنفيذ التجريبي.
- `src/features/cart`: مخزن سلة معزول وتخزين محلي متحقق منه.
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
npx --yes pnpm@12.5.1 test:e2e
npx --yes pnpm@12.5.1 build
```

سياسة CSP مع nonce مؤجلة إلى مرحلة إضافة طبقة الخادم أو المصادقة، لتجنب سياسة
شكلية أو غير متوافقة مع مخرجات Next.js. رؤوس الحماية الآمنة وغير المتعارضة
مفعّلة حالياً في `next.config.ts`.
