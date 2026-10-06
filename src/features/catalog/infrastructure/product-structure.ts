import "server-only";

import { and, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  purchaseBlockers,
  structureProblems,
} from "@/features/catalog/domain/product-media-validation";
import * as schema from "@/server/db/schema";

type Executor = Pick<PostgresJsDatabase<typeof schema>, "select">;

/**
 * Published products whose variants are left incomplete (for example right after a new option was added):
 * customers see them as unavailable and the order service refuses them, so no variant is guessed.
 */
export async function incompleteProductIds(
  executor: Executor,
  productIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Set();
  const [options, values, variants, links] = await Promise.all([
    executor
      .select({
        id: schema.productOptions.id,
        productId: schema.productOptions.productId,
        nameAr: schema.productOptions.nameAr,
        kind: schema.productOptions.kind,
      })
      .from(schema.productOptions)
      .where(
        and(
          inArray(schema.productOptions.productId, ids),
          isNull(schema.productOptions.archivedAt),
        ),
      ),
    executor
      .select({
        id: schema.productOptionValues.id,
        optionId: schema.productOptionValues.optionId,
      })
      .from(schema.productOptionValues)
      .where(
        and(
          inArray(schema.productOptionValues.productId, ids),
          isNull(schema.productOptionValues.archivedAt),
        ),
      ),
    executor
      .select({
        id: schema.productVariants.id,
        productId: schema.productVariants.productId,
        labelAr: schema.productVariants.labelAr,
        isDefault: schema.productVariants.isDefault,
        availability: schema.productVariants.availability,
      })
      .from(schema.productVariants)
      .where(
        and(
          inArray(schema.productVariants.productId, ids),
          isNull(schema.productVariants.archivedAt),
        ),
      ),
    executor
      .select({
        variantId: schema.productVariantOptionValues.variantId,
        optionId: schema.productVariantOptionValues.optionId,
        valueId: schema.productVariantOptionValues.valueId,
      })
      .from(schema.productVariantOptionValues)
      .where(inArray(schema.productVariantOptionValues.productId, ids)),
  ]);
  const selections = new Map<string, Record<string, string>>();
  for (const link of links) {
    selections.set(link.variantId, {
      ...selections.get(link.variantId),
      [link.optionId]: link.valueId,
    });
  }
  const blocked = new Set<string>();
  for (const productId of ids) {
    const problems = structureProblems({
      options: options
        .filter((option) => option.productId === productId)
        .map((option) => ({
          id: option.id,
          nameAr: option.nameAr,
          kind: option.kind,
          archived: false,
          values: values
            .filter((value) => value.optionId === option.id)
            .map((value) => ({
              id: value.id,
              valueAr: "",
              usesSharedImage: false,
            })),
        })),
      variants: variants
        .filter((variant) => variant.productId === productId)
        .map((variant) => ({
          id: variant.id,
          archived: false,
          optionValues: selections.get(variant.id) ?? {},
          labelAr: variant.labelAr,
          isDefault: variant.isDefault,
          available: variant.availability === "available",
        })),
      images: [],
    });
    if (purchaseBlockers(problems).length) blocked.add(productId);
  }
  return blocked;
}
