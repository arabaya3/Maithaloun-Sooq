import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { orderGallery } from "@/features/catalog/domain/product-gallery";
import {
  sortOptions,
  type ProductOption,
} from "@/features/catalog/domain/product-options";
import {
  emptyPresentation,
  type ProductPresentation,
} from "@/features/catalog/domain/product-presentation";
import * as schema from "@/server/db/schema";

// The product page loads gallery and options once; selection then runs on this data without further requests.
export async function loadProductPresentation(
  database: PostgresJsDatabase<typeof schema>,
  productDomainId: string,
): Promise<ProductPresentation> {
  const [product] = await database
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.domainId, productDomainId));
  if (!product) return emptyPresentation;
  const [images, options, values, variants, links] = await Promise.all([
    database
      .select()
      .from(schema.productImages)
      .where(
        and(
          eq(schema.productImages.productId, product.id),
          isNull(schema.productImages.archivedAt),
        ),
      )
      .orderBy(
        sql`${schema.productImages.isPrimary} DESC`,
        asc(schema.productImages.sortOrder),
      ),
    database
      .select()
      .from(schema.productOptions)
      .where(
        and(
          eq(schema.productOptions.productId, product.id),
          isNull(schema.productOptions.archivedAt),
        ),
      ),
    database
      .select()
      .from(schema.productOptionValues)
      .where(
        and(
          eq(schema.productOptionValues.productId, product.id),
          isNull(schema.productOptionValues.archivedAt),
        ),
      ),
    database
      .select({
        id: schema.productVariants.id,
        domainId: schema.productVariants.domainId,
        packCount: schema.productVariants.packCount,
      })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, product.id),
          isNull(schema.productVariants.archivedAt),
        ),
      ),
    database
      .select()
      .from(schema.productVariantOptionValues)
      .where(eq(schema.productVariantOptionValues.productId, product.id)),
  ]);
  const domainOf = new Map(variants.map((row) => [row.id, row.domainId]));
  const liveOptions: ProductOption[] = sortOptions(options).map((option) => ({
    id: option.id,
    nameAr: option.nameAr,
    kind: option.kind,
    sortOrder: option.sortOrder,
    values: values
      .filter((value) => value.optionId === option.id)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((value) => ({
        id: value.id,
        valueAr: value.valueAr,
        sortOrder: value.sortOrder,
      })),
  }));
  const variantOptions: Record<string, Record<string, string>> = {};
  for (const link of links) {
    const variantId = domainOf.get(link.variantId);
    if (!variantId) continue;
    variantOptions[variantId] = {
      ...(variantOptions[variantId] ?? {}),
      [link.optionId]: link.valueId,
    };
  }
  return {
    gallery: orderGallery(
      images.map((image) => ({
        id: image.id,
        src: image.src,
        alt: image.altAr,
        width: image.width,
        height: image.height,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
        variantId: image.variantId
          ? (domainOf.get(image.variantId) ?? null)
          : null,
      })),
    ),
    options: liveOptions.filter((option) => option.values.length),
    variantOptions,
    packCounts: Object.fromEntries(
      variants.map((row) => [row.domainId, row.packCount]),
    ),
  };
}
