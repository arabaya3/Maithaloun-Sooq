import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

const productSeed: (typeof schema.products.$inferInsert)[] = [
  {
    domainId: "general-cleaner",
    slug: "general-cleaner-secret",
    nameAr: "منظف عام",
    latinName: "Secret",
    priceAgorot: 700,
    sortOrder: 1,
    categoryId: "home",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "general-cleaner",
    detailsStatus: "placeholder",
  },
  {
    domainId: "dolphin-bleach",
    slug: "dolphin-bleach",
    nameAr: "مبيض",
    latinName: "Dolphin",
    priceAgorot: 800,
    sortOrder: 2,
    categoryId: "laundry",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "bleach",
    detailsStatus: "placeholder",
  },
  {
    domainId: "carpet-brush",
    slug: "carpet-brush",
    nameAr: "فرشاة سجاد",
    priceAgorot: 500,
    sortOrder: 3,
    categoryId: "tools",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "brush",
    detailsStatus: "placeholder",
  },
  {
    domainId: "arar-dish-liquid",
    slug: "arar-dish-liquid",
    nameAr: "سائل جلي",
    latinName: "Arar",
    priceAgorot: 1200,
    sortOrder: 4,
    categoryId: "kitchen",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "dish-liquid",
    detailsStatus: "placeholder",
  },
  {
    domainId: "smart-floor-cleaner",
    slug: "smart-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Smart",
    priceAgorot: 1000,
    sortOrder: 5,
    categoryId: "home",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "floor-cleaner",
    detailsStatus: "placeholder",
  },
  {
    domainId: "musk-floor-cleaner",
    slug: "musk-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Musk",
    priceAgorot: 1000,
    sortOrder: 6,
    categoryId: "home",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "floor-cleaner",
    detailsStatus: "placeholder",
  },
  {
    domainId: "lilac-floor-cleaner",
    slug: "lilac-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Lilac",
    priceAgorot: 1000,
    sortOrder: 7,
    categoryId: "home",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "floor-cleaner",
    detailsStatus: "placeholder",
  },
  {
    domainId: "degreaser-8",
    slug: "degreaser-8",
    nameAr: "مزيل دهون",
    priceAgorot: 800,
    sortOrder: 8,
    categoryId: "kitchen",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "degreaser",
    detailsStatus: "placeholder",
  },
  {
    domainId: "degreaser-10",
    slug: "degreaser-10",
    nameAr: "مزيل دهون",
    priceAgorot: 1000,
    sortOrder: 9,
    categoryId: "kitchen",
    availability: "available",
    imageKind: "placeholder",
    placeholderVariant: "degreaser",
    detailsStatus: "placeholder",
  },
];

const serviceAreaSeed: (typeof schema.serviceAreas.$inferInsert)[] = [
  {
    code: "ramallah",
    nameAr: "رام الله",
    enabled: false,
    sortOrder: 1,
    deliveryFeeAgorot: null,
  },
  {
    code: "al-bireh",
    nameAr: "البيرة",
    enabled: false,
    sortOrder: 2,
    deliveryFeeAgorot: null,
  },
  {
    code: "maythalun",
    nameAr: "ميثلون",
    enabled: true,
    sortOrder: 3,
    deliveryFeeAgorot: null,
  },
  {
    code: "other",
    nameAr: "منطقة أخرى",
    enabled: false,
    sortOrder: 4,
    deliveryFeeAgorot: null,
  },
];

export async function insertVerifiedReferenceData(
  database: PostgresJsDatabase<typeof schema>,
) {
  await database
    .insert(schema.products)
    .values(productSeed)
    .onConflictDoNothing({ target: schema.products.domainId });
  await database
    .insert(schema.serviceAreas)
    .values(serviceAreaSeed)
    .onConflictDoNothing({ target: schema.serviceAreas.code });

  await database
    .update(schema.serviceAreas)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      inArray(schema.serviceAreas.code, ["ramallah", "al-bireh", "other"]),
    );
  await database
    .update(schema.serviceAreas)
    .set({ enabled: true, nameAr: "ميثلون", updatedAt: new Date() })
    .where(eq(schema.serviceAreas.code, "maythalun"));

  const [{ productVariantsTable }] = await database.execute<{
    productVariantsTable: string | null;
  }>(
    sql`select to_regclass('public.product_variants') as "productVariantsTable"`,
  );
  if (!productVariantsTable) {
    return;
  }

  const existingProducts = await database.select().from(schema.products);
  for (const product of existingProducts) {
    const [existingVariant] = await database
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id))
      .limit(1);
    if (existingVariant) continue;

    await database.insert(schema.productVariants).values({
      productId: product.id,
      domainId: `${product.domainId}--default`,
      labelAr: product.unit?.trim() || "الافتراضي",
      attributes: product.unit?.trim() ? { الوحدة: product.unit.trim() } : {},
      priceAgorot: product.priceAgorot,
      availability: product.availability,
      imageKind: product.imageKind,
      imageSrc: product.imageSrc,
      imageAlt: product.imageAlt,
      imageWidth: product.imageWidth,
      imageHeight: product.imageHeight,
      placeholderVariant: product.placeholderVariant,
      sortOrder: 0,
      isDefault: true,
    });
  }
}

export async function seedDevelopmentDatabase(
  database: PostgresJsDatabase<typeof schema>,
) {
  await insertVerifiedReferenceData(database);
}
