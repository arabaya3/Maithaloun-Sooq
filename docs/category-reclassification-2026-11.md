# Category reclassification proposal (November 2026)

Written from a **read-only** look at the production catalog on 2026-11-23 (product names, descriptions and
photo URLs; 110 products, 11 visible categories in use). Nothing was written to production.

- Plan file: `tools/data/category-reclassification-plan.json`
- Tool: `tools/reclassify-categories.ts` (dry run by default, `--apply`, `--rollback <backup>`)
- **20 products** get a change: **3 primary corrections** (each keeps its old category as an extra) and
  **17 products** that only gain extra categories. **9 products** are listed as unclear and left unchanged.
- Only existing categories are used. Names, prices, stock, photos and `updated_at` are never written.

Wipes are split by what they are for:

- **Kitchen degreasing wipes** → primary «المطبخ والجلي», extra «الورقيات والمناديل».
- **Floor / general cleaning wipes** → primary «منظفات المنزل», extra «الورقيات والمناديل».
- **Personal-care and baby wet wipes** → primary stays personal care / baby care, extra «الورقيات والمناديل».
- **Paper tissues, toilet paper, paper towels** stay in «الورقيات والمناديل».

## Proposed changes

| Product | Previous category | Primary | Extras | Reason |
| --- | --- | --- | --- | --- |
| product-13b6f6f9 مناديل مبللة لتنظيف المطبخ وإزالة الدهون إنفينيو | kitchen-dishwashing | kitchen-dishwashing | paper-tissues | Kitchen degreasing wipes; also found with wipes |
| product-939384b6 مناديل مبللة لتنظيف الأرضيات إنفينيو فلور | paper-tissues | **home-cleaners** | paper-tissues | A floor cleaner, not a paper tissue |
| product-753b43ea دلو مناديل تنظيف عامة متعددة الاستخدامات | paper-tissues | **home-cleaners** | paper-tissues | General cleaning wipes (dirt, grease, stains) |
| product-ce080b30 محارم نيو كومباكت المبللة من كومفرت | personal-care | personal-care | paper-tissues | Personal wet wipes |
| product-f9480186 مناديل جونسون بيبي المبللة | baby-care | baby-care | paper-tissues | Baby wet wipes |
| product-45f90fa1 مناديل بامبرز فريش كلين | baby-care | baby-care | paper-tissues | Baby wet wipes |
| product-6dd3177a محارم هابي نايس المبللة للأطفال | baby-care | baby-care | paper-tissues | Baby wet wipes |
| product-5c0ffd8a مناشف ورقية السلطان | paper-tissues | paper-tissues | kitchen-dishwashing | Description: for everyday kitchen use |
| product-490b7203 سائل غسيل ملابس الأطفال البركان | baby-care | baby-care | laundry | A laundry detergent for baby clothes |
| product-29da8efe شامبو السنافر للأطفال | personal-care | personal-care | baby-care | Children's shampoo |
| product-875b0b09 شامبو جونسون للأطفال | personal-care | personal-care | baby-care | Baby shampoo |
| product-3c53ea27 طقم مزيل الدهون البارد ثاندر | home-cleaners | home-cleaners | kitchen-dishwashing | Degreaser |
| product-eca2b842 فينيسيا مزيل الزيوت والدهون | kitchen-dishwashing | kitchen-dishwashing | home-cleaners | Multi-purpose degreaser |
| product-46ef798d جل منظف البركان متعدد الاستخدامات | home-cleaners | home-cleaners | kitchen-dishwashing, bathroom | Name lists kitchens, bathrooms, floors |
| product-41da5f9f معجون البركان متعدد الاستخدامات | home-cleaners | home-cleaners | kitchen-dishwashing | Tough dirt and grease paste |
| product-2a3cc6a2 كلور دولفين | home-cleaners | home-cleaners | laundry | Description mentions whitening clothes |
| product-a718315e مزيل البقع متعدد الاستخدامات البركان | home-cleaners | home-cleaners | carpet-upholstery | Fabrics, carpets and upholstery |
| product-a1fc8efe مزيل الروائح لايت ويف | home-cleaners | **home-fragrances** | home-cleaners | Odour remover, like the other one already in fragrances |
| product-d48ded64 بودرة معطر السجاد والغرف البركان | carpet-upholstery | carpet-upholstery | home-fragrances | Carpet and room freshener |
| product-d35ed5dc فرشاة تنظيف السجاد والموكيت | carpet-upholstery | carpet-upholstery | cleaning-tools | A hand brush |

## Unclear — left unchanged (9)

| Product | Category | Note |
| --- | --- | --- |
| product-2b99a86f دلو محارم مسك المعطرة | paper-tissues | Description too short to tell tissues from wet cleaning wipes |
| product-13b95df6, product-0a007a73, product-4ed55e78 (bin bags) | cleaning-tools | An archived, hidden «أكياس النفايات والقمامة» category exists; restoring it is the owner's call |
| product-6b02b51b food wrap (with freezer bags, sandwich bags, foil) | kitchen-dishwashing | Not dishwashing; a «حفظ الطعام» category is a **proposal only** |
| product-1ecdabec hand soap | personal-care | Could also be shown in the bathroom |
| product-58d32a34 BON toilet block | bathroom | Could also be a home fragrance |
| product-a7939dec Finish dishwasher cleaner | category-3 (archived) | Archived product in an archived category; not on the storefront |
| product-1f376033 mosquito repeller | category-6 | That category has no English name; English shoppers see the Arabic |

## New categories (proposals only, nothing created)

- «حفظ الطعام» (food storage: bags, wrap, foil).
- Restoring «أكياس النفايات والقمامة» for the three bin-bag products.

## How to run it (owner's decision; not run against production)

On the server, after the migration that creates `product_category_links` has been deployed:

```sh
cd /opt/maytha
# 1. Dry run: prints every change, writes nothing
docker compose --profile deploy run --rm migrate pnpm exec tsx tools/reclassify-categories.ts
# 2. Apply: writes a backup of the touched products first, then applies in one transaction
docker compose --profile deploy run --rm -v /opt/maytha/backups:/backups migrate \
  pnpm exec tsx tools/reclassify-categories.ts --apply --backup-dir /backups
# 3. Undo, if needed
docker compose --profile deploy run --rm -v /opt/maytha/backups:/backups migrate \
  pnpm exec tsx tools/reclassify-categories.ts --rollback /backups/categories-<timestamp>.json
```

Running `--apply` again finds nothing to do. Entries whose product moved since the plan was written are
skipped, not forced. The storefront shows the result after its next refresh (any catalog save, or the
storefront-day cron).
