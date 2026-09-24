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

لإنشاء أو تدوير حساب المالك المحلي فقط:

```bash
npx --yes pnpm@12.5.1 admin:owner
```

الأمر يعمل على `maithalun_dev` عبر loopback فقط، ولا يقبل كلمة المرور كوسيط
سطر أوامر، ولا يوجد تسجيل عام للزبائن.

`TRUST_PROXY=true` يُضبط فقط عندما تعيد المنصة كتابة ترويسة عنوان الشبكة
الموثوقة. لا تفعّله إذا كان العميل قادراً على تعيين `X-Forwarded-For`.

## البنية

- `src/app`: المسارات، البيانات الوصفية، الـ manifest والـ service worker.
- `src/features/catalog`: نموذج المنتجات وواجهة مستودع PostgreSQL.
- `src/features/cart`: مخزن سلة معزول وتخزين محلي متحقق منه.
- `src/features/admin`: مصادقة المالك وإدارة الطلبات والمنتجات ومناطق التوصيل.
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

## الإنتاج

يستخدم النشر اتصال PostgreSQL مجمّعاً عبر متغير `DATABASE_URL` سرياً على
الخادم. جداول Supabase محمية بـ RLS ولا تمنح `anon` أو `authenticated` وصولاً
مباشراً؛ جميع الأسعار والطلبات وعمليات الإدارة تمر عبر خدمات التطبيق الخادمية.
لا تضع رابط قاعدة البيانات أو قيمة `ORDER_RATE_LIMIT_PEPPER` في Git أو في متغير
يبدأ بـ `NEXT_PUBLIC_`.

لإنشاء أول حساب مالك على الإنتاج، أو لإعادة تعيين كلمة مروره (تفاعلي، بدون
كلمة مرور في سطر الأوامر؛ نفس اسم المستخدم الحالي مطلوب لإعادة التعيين):

```bash
# عيّن DATABASE_URL من لوحة Vercel Production في جلسة طرفية محلية فقط، ثم:
ALLOW_PRODUCTION_OWNER_BOOTSTRAP=1 npx --yes pnpm@12.5.1 admin:owner:production
```

كلمة المرور يجب أن تكون بين 12 و 128 حرفاً. لا تلصق `DATABASE_URL` أو كلمة
المرور في Git أو المحادثة. امسح متغير البيئة بعد الانتهاء.
