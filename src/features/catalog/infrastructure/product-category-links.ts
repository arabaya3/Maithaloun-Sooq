import "server-only";

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { normalizeExtraCategories } from "@/features/catalog/domain/product-categories";
import * as schema from "@/server/db/schema";

type Executor = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "insert" | "delete"
>;

/** Every category each product is listed in, by product UUID, in storefront category order. */
export async function loadCategoryLinks(
  database: Executor,
  productIds: readonly string[],
): Promise<Map<string, string[]>> {
  const links = new Map<string, string[]>();
  if (!productIds.length) return links;
  const rows = await database
    .select({
      productId: schema.productCategoryLinks.productId,
      code: schema.productCategoryLinks.categoryCode,
    })
    .from(schema.productCategoryLinks)
    .innerJoin(
      schema.productCategories,
      eq(
        schema.productCategories.code,
        schema.productCategoryLinks.categoryCode,
      ),
    )
    .where(inArray(schema.productCategoryLinks.productId, [...productIds]))
    .orderBy(
      asc(schema.productCategories.sortOrder),
      asc(schema.productCategories.code),
    );
  for (const row of rows) {
    const list = links.get(row.productId) ?? [];
    list.push(row.code);
    links.set(row.productId, list);
  }
  return links;
}

/**
 * Sets the extra categories of one product to exactly `extras`; the primary is kept as a link.
 * Only call it when the editor actually sent a list: a save without one leaves the extras alone.
 */
export async function replaceExtraCategories(
  database: Executor,
  productId: string,
  primary: string,
  extras: readonly string[],
): Promise<string[]> {
  const wanted = normalizeExtraCategories(primary, extras);
  const keep = [primary, ...wanted];
  await database
    .delete(schema.productCategoryLinks)
    .where(
      and(
        eq(schema.productCategoryLinks.productId, productId),
        notInArray(schema.productCategoryLinks.categoryCode, keep),
      ),
    );
  await database
    .insert(schema.productCategoryLinks)
    .values(keep.map((categoryCode) => ({ productId, categoryCode })))
    .onConflictDoNothing();
  return wanted;
}
