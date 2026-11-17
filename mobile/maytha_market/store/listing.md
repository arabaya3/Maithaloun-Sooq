# MAYTHA MARKET — Store listing text

App name: **MAYTHA MARKET**
Package / bundle id: `market.maytha.app`
Category: Shopping
Default language: Arabic (ar). Also: English (en-US).
Website / support / marketing URL: https://www.maytha.app
Privacy policy URL: https://www.maytha.app/privacy
Contact (WhatsApp): +972599105456

## Field limits (characters) and current length

| Field | Limit | Arabic | English |
|---|---|---|---|
| Play title / App Store name: `MAYTHA MARKET` | 30 | 13 | 13 |
| Play short description | 80 | 62 | 80 |
| Play full description / App Store description | 4000 | 437 | 507 |
| App Store subtitle | 30 | 22 | 27 |
| App Store promotional text | 170 | 105 | 106 |
| App Store keywords (comma separated, no spaces after commas) | 100 | 67 | 88 |

Lengths are Unicode characters (code points). The same full description is used in both stores.

## Arabic (ar)

**وصف قصير (حتى 80 حرفاً):**
ماركات بتعرفها وبتثق فيها، لبيت أنظف وأجمل. توصيل داخل ميثلون.

**العنوان الفرعي (App Store، حتى 30 حرفاً):**
منظفات ومستلزمات البيت

**النص الترويجي (App Store، حتى 170 حرفاً):**
ماركات بتعرفها وبتثق فيها. اطلب عبر واتساب، والتوصيل داخل ميثلون مجاني من 50 ₪. الدفع نقداً عند الاستلام.

**الكلمات المفتاحية (App Store، حتى 100 حرف):**
منظفات,تنظيف,مستلزمات البيت,ميثلون,سوق,بقالة,واتساب,توصيل,معطر,غسيل

**الوصف الكامل (Play و App Store، حتى 4000 حرف):**
MAYTHA MARKET متجر منظفات ومستلزمات البيت في ميثلون.

• تصفّح المنتجات حسب القسم، وابحث بالاسم أو الماركة.
• اختر النوع والعبوة (حبة أو كرتونة) والكمية.
• أضف المنتجات للسلة وشاهد المجموع ورسوم التوصيل.
• أرسل طلبك برسالة واتساب جاهزة إلى المتجر.
• احفظ منتجاتك المفضلة.

التوصيل داخل ميثلون فقط: 5 ₪ إذا كان مجموع المنتجات أقل من 50 ₪، ومجاني من 50 ₪.
الدفع نقداً عند الاستلام.
لا حاجة لإنشاء حساب، والسلة والمفضلة محفوظة على جهازك فقط.

## English (en-US)

**Short description (max 80 chars):**
Brands you know and trust, for a cleaner, brighter home. Delivery in Maythaloun.

**Subtitle (App Store, max 30):**
Home cleaning in Maythaloun

**Promotional text (App Store, max 170):**
Brands you know and trust. Order via WhatsApp; delivery in Maythaloun is free from 50 ₪. Cash on delivery.

**Keywords (App Store, max 100):**
cleaning,detergent,household,Maythaloun,Meithalun,grocery,WhatsApp,delivery,laundry,soap

**Full description (Play and App Store, max 4000):**
MAYTHA MARKET is a home-cleaning and household store in Maythaloun.

• Browse products by category and search by name or brand.
• Choose the option, pack (single or carton) and quantity.
• Add to cart and see the subtotal and delivery fee.
• Send your order as a ready-made WhatsApp message to the store.
• Save your favorite products.

Delivery within Maythaloun only: 5 ₪ when products total less than 50 ₪, free from 50 ₪.
Cash on delivery.
No account needed; your cart and favorites stay on your device.

## Graphic assets
| Asset | Path | Pixels |
|---|---|---|
| Play icon (32-bit PNG) | `store/play/icon-512.png` | 512×512 |
| Play feature graphic (24-bit PNG, no alpha) | `store/play/feature-graphic-1024x500.png` | 1024×500 |
| Play phone screenshots (Android 16 emulator, live store) | `store/screenshots/01-ar-home.png` … `06-en-product.png` | 1080×2340 |
| App Store iPhone 6.9" screenshots (iPhone 16 Pro Max simulator, live store) | `store/app-store/01-ar-home.png` … `06-en-product.png` | 1320×2868 |

The feature graphic and Play icon are rendered by `store/source/render-store-graphics.mjs` from the brand monogram, colors and fonts: run `node mobile/maytha_market/store/source/render-store-graphics.mjs` from the repository root after `pnpm install`.
App Store screenshots come from the `store-screenshots` GitHub workflow (`.github/workflows/store-screenshots.yml`, can be run manually); download its `app-store-screenshots-6.9` artifact.
The app targets iPhone only (`TARGETED_DEVICE_FAMILY = 1`), so App Store Connect does not ask for iPad screenshots.

## Notes for the owner
- Product names come from the store data and are currently Arabic in both languages.
- Do not claim features the app does not have (no online payment, no order tracking, no accounts).
