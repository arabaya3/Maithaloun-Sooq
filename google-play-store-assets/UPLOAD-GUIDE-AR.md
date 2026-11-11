# دليل رفع ملفات MAYTHA MARKET على Google Play Console

قبل الرفع: شغّل `node mobile/maytha_market/store/source/validate-assets.mjs` وتأكد أن VALIDATION-REPORT.md كله PASS.

## 1) تفاصيل التطبيق
**Grow users → Store presence → Main store listing → App details**

| الحقل | من وين | الحالة |
|---|---|---|
| App name | `MAYTHA MARKET` | إلزامي |
| Short description | `google-play-listing-ar.md` ← الوصف القصير | إلزامي |
| Full description | `google-play-listing-ar.md` ← الوصف الكامل | إلزامي |

النسخة الإنجليزية (اختيارية كترجمة): النصوص الإنجليزية في `mobile/maytha_market/store/listing.md`.

## 2) الرسومات
**Grow users → Store presence → Main store listing → Graphics**

| الخانة | الملف | الحالة |
|---|---|---|
| App icon (512×512) | `icon/MAYTHA_icon_512x512.png` | إلزامي |
| Feature graphic (1024×500) | `feature-graphic/MAYTHA_feature_1024x500.png` | إلزامي |
| Phone screenshots (2–8) | كل الملفات في `phone-screenshots/` بالترتيب 01 → 08 | إلزامي (8 لقطات) |
| 7-inch tablet screenshots | لا يوجد — انظر `tablet-7-inch/README.md` | اختياري — غير مرفوع |
| 10-inch tablet screenshots | لا يوجد — انظر `tablet-10-inch/README.md` | اختياري — غير مرفوع |
| Chromebook / Android XR / TV / Wear OS | `optional-platform-assets/README.md` | لا ينطبق |
| Video (YouTube) | — | اختياري — غير متوفر |

## 3) إعدادات المتجر
**Grow users → Store presence → Store settings**

| الحقل | القيمة | الحالة |
|---|---|---|
| App or game | App | إلزامي |
| Category | Shopping | إلزامي |
| Tags | اختر من قائمة Google وسوماً مرتبطة بالتسوّق ومستلزمات المنزل | اختياري |
| Email address | **ناقص — على المالك توفيره** | إلزامي |
| Phone number | +972599105456 | اختياري |
| Website | https://maithaloun-sooq.vercel.app | اختياري |

## 4) أماكن أخرى (خارج هذه الحزمة)
- **Policy and programs → App content**: Privacy policy = https://maithaloun-sooq.vercel.app/privacy ، Data safety ، Content rating ، Target audience. حذف الحساب: لا ينطبق (لا حسابات في التطبيق).
- **Test and release**: رفع ملف AAB موقّع بمفتاح الرفع.
