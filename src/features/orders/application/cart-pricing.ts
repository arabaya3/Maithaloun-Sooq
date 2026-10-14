import "server-only";

import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { calculateLineSubtotal } from "@/features/cart/cart-store";
import { priceSellingUnit } from "@/features/catalog/domain/offer-pricing";
import { variantAttributesSchema } from "@/features/catalog/domain/product-variant";
import { liveOffersForVariants } from "@/features/catalog/infrastructure/offer-queries";
import { incompleteProductIds } from "@/features/catalog/infrastructure/product-structure";
import {
  loadVariantCommerce,
  singlePiecePrice,
} from "@/features/catalog/infrastructure/variant-commerce";
import { calculateDeliveryFeeAgorot } from "@/features/delivery/delivery-policy";
import { unitsToMilli } from "@/features/inventory/domain/quantity";
import type { CheckoutItem } from "@/features/orders/domain/checkout-request";
import * as schema from "@/server/db/schema";

export type CartPricingErrorCode =
  | "unknown_product"
  | "unavailable_product"
  | "selling_unit_changed"
  | "insufficient_stock";

export class CartPricingError extends Error {
  constructor(readonly code: CartPricingErrorCode) {
    super(code);
    this.name = "CartPricingError";
  }
}

type Database = Pick<PostgresJsDatabase<typeof schema>, "select">;

/**
 * The one authoritative price and stock check for a cart, shared by order creation and every
 * quote (website WhatsApp button, assistant, mobile app). Clients send identifiers and counts only;
 * prices, offers, free stock and delivery are read here at this moment.
 */
export async function priceCart(
  database: Database,
  items: readonly CheckoutItem[],
  options: { allowQaProbe?: boolean } = {},
) {
  const allowQaProbe = options.allowQaProbe === true;
  const requestedVariantIds = items.map((item) => item.variantId);
  const variantRows = await database
    .select({ variant: schema.productVariants, product: schema.products })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .where(inArray(schema.productVariants.domainId, requestedVariantIds));

  const variantsById = new Map(
    variantRows.map((row) => [row.variant.domainId, row]),
  );
  if (variantsById.size !== new Set(requestedVariantIds).size) {
    throw new CartPricingError("unknown_product");
  }

  const commerce = await loadVariantCommerce(
    database,
    variantRows.map((row) => row.variant.id),
  );
  const incomplete = await incompleteProductIds(
    database,
    variantRows.map((row) => row.product.id),
  );
  const offers = await liveOffersForVariants(
    database,
    variantRows.map((row) => ({
      variantId: row.variant.id,
      productId: row.product.id,
      categoryCode: row.product.categoryId,
      priceAgorot: singlePiecePrice(row.variant, commerce),
    })),
    new Date(),
  );

  const lines = items.map((item) => {
    const row = variantsById.get(item.variantId);
    if (!row) throw new CartPricingError("unknown_product");
    if (row.product.domainId !== item.productId) {
      throw new CartPricingError("unknown_product");
    }
    const qaProbe = allowQaProbe && row.variant.qaOwned;
    if (
      (row.variant.qaOwned && !qaProbe) ||
      row.variant.availability !== "available" ||
      row.variant.archivedAt ||
      row.product.archivedAt ||
      incomplete.has(row.product.id) ||
      (row.product.publication !== "published" && !qaProbe)
    ) {
      throw new CartPricingError("unavailable_product");
    }
    const units = (commerce.get(row.variant.id)?.units ?? []).filter(
      (unit) => !unit.archivedAt,
    );
    // A request without a unit comes from a client that bought single pieces only.
    const unit = item.sellingUnitId
      ? units.find((entry) => entry.id === item.sellingUnitId)
      : units.find((entry) => entry.unitsPerSale === 1);
    if (
      !unit ||
      (item.unitsPerSale !== undefined &&
        item.unitsPerSale !== unit.unitsPerSale)
    ) {
      throw new CartPricingError("selling_unit_changed");
    }
    const attributes = variantAttributesSchema.parse(
      row.variant.attributes ?? {},
    );
    const priced = priceSellingUnit(
      unit,
      offers.get(row.variant.id),
      item.quantity,
    );
    const lineSubtotalAgorot = calculateLineSubtotal(
      priced.unitPriceAgorot,
      item.quantity,
    );
    return {
      ...item,
      product: row.product,
      variant: row.variant,
      unit,
      attributes,
      priced,
      lineSubtotalAgorot,
    };
  });

  // Packs and singles of one variant draw on the same base stock, so they are checked together.
  const requiredMilli = new Map<string, number>();
  for (const line of lines) {
    requiredMilli.set(
      line.variant.id,
      (requiredMilli.get(line.variant.id) ?? 0) +
        unitsToMilli(line.quantity * line.unit.unitsPerSale),
    );
  }
  for (const [variantId, milli] of requiredMilli) {
    const free = commerce.get(variantId)?.freeBaseMilli ?? null;
    if (free !== null && milli > free) {
      throw new CartPricingError("insufficient_stock");
    }
  }

  const itemsSubtotalAgorot = lines.reduce(
    (total, line) => total + line.lineSubtotalAgorot,
    0,
  );
  const deliveryFeeAgorot = calculateDeliveryFeeAgorot(itemsSubtotalAgorot);
  return {
    lines,
    itemsSubtotalAgorot,
    deliveryFeeAgorot,
    finalTotalAgorot: itemsSubtotalAgorot + deliveryFeeAgorot,
  };
}
