import "server-only";

import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";

import type { SellingUnitRow, VariantCommerce } from "./product-row-mapper";

type Executor = Pick<PostgresJsDatabase<typeof schema>, "select">;

// Two set-based queries for any number of variants: no request per selling unit.
export async function loadVariantCommerce(
  executor: Executor,
  variantIds: readonly string[],
): Promise<Map<string, VariantCommerce>> {
  if (!variantIds.length) return new Map();
  const ids = [...new Set(variantIds)];
  return loadCommerce(executor, ids, {
    units: inArray(schema.productSellingUnits.variantId, ids),
    stock: inArray(schema.inventoryItems.variantId, ids),
  });
}

/**
 * The same data keyed by product, so the storefront can fetch it alongside the variants themselves
 * instead of in a second round trip; variants not in the result have no units and no stock.
 */
export async function loadProductCommerce(
  executor: Executor,
  productIds: readonly string[],
): Promise<Map<string, VariantCommerce>> {
  if (!productIds.length) return new Map();
  const ids = [...new Set(productIds)];
  return loadCommerce(executor, null, {
    units: inArray(schema.productSellingUnits.productId, ids),
    stock: inArray(
      schema.inventoryItems.variantId,
      executor
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(inArray(schema.productVariants.productId, ids)),
    ),
  });
}

async function loadCommerce(
  executor: Executor,
  variantIds: string[] | null,
  where: { units: SQL; stock: SQL },
): Promise<Map<string, VariantCommerce>> {
  const result = new Map<string, VariantCommerce>();
  const [units, stock] = await Promise.all([
    executor.select().from(schema.productSellingUnits).where(where.units),
    executor
      .select({
        variantId: schema.inventoryItems.variantId,
        onHandMilli: schema.inventoryItems.onHandMilli,
        reservedMilli: schema.inventoryItems.reservedMilli,
      })
      .from(schema.inventoryItems)
      .innerJoin(
        schema.inventoryLocations,
        and(
          eq(schema.inventoryLocations.id, schema.inventoryItems.locationId),
          eq(schema.inventoryLocations.isDefault, true),
        ),
      )
      .where(where.stock),
  ]);
  const free = new Map(
    stock.map((row) => [row.variantId, row.onHandMilli - row.reservedMilli]),
  );
  const byVariant = new Map<string, SellingUnitRow[]>();
  for (const unit of units) {
    byVariant.set(unit.variantId, [
      ...(byVariant.get(unit.variantId) ?? []),
      unit,
    ]);
  }
  const ids = variantIds ?? [...new Set([...byVariant.keys(), ...free.keys()])];
  for (const id of ids) {
    result.set(id, {
      units: byVariant.get(id) ?? [],
      freeBaseMilli: free.has(id) ? free.get(id)! : null,
    });
  }
  return result;
}

/** The regular price offers are computed against: the active one-piece unit, else the variant price. */
export function singlePiecePrice(
  variant: { id: string; priceAgorot: number },
  commerce: ReadonlyMap<string, VariantCommerce>,
): number {
  const single = commerce
    .get(variant.id)
    ?.units.find((unit) => !unit.archivedAt && unit.unitsPerSale === 1);
  return single?.priceAgorot ?? variant.priceAgorot;
}
