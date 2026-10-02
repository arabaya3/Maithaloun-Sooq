import "server-only";

import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  offerUnitPrice,
  type VariantOffer,
} from "@/features/catalog/domain/offer-pricing";
import * as schema from "@/server/db/schema";

type Executor = Pick<PostgresJsDatabase<typeof schema>, "select">;

export interface PricedVariantRow {
  variantId: string;
  productId: string;
  categoryCode: string;
  priceAgorot: number;
}

// Live offers per variant UUID; when several apply, the lowest valid price wins.
export async function liveOffersForVariants(
  executor: Executor,
  variants: readonly PricedVariantRow[],
  now: Date,
): Promise<Map<string, VariantOffer>> {
  const result = new Map<string, VariantOffer>();
  if (!variants.length) return result;
  const variantIds = variants.map((row) => row.variantId);
  const productIds = [...new Set(variants.map((row) => row.productId))];
  const categoryCodes = [...new Set(variants.map((row) => row.categoryCode))];
  const rows = await executor
    .select({ offer: schema.offers, target: schema.offerTargets })
    .from(schema.offerTargets)
    .innerJoin(schema.offers, eq(schema.offers.id, schema.offerTargets.offerId))
    .where(
      and(
        eq(schema.offers.enabled, true),
        isNull(schema.offers.archivedAt),
        or(isNull(schema.offers.startsAt), lte(schema.offers.startsAt, now)),
        or(isNull(schema.offers.endsAt), gt(schema.offers.endsAt, now)),
        or(
          inArray(schema.offerTargets.variantId, variantIds),
          inArray(schema.offerTargets.productId, productIds),
          inArray(schema.offerTargets.categoryCode, categoryCodes),
        ),
      ),
    );
  for (const variant of variants) {
    let best: { offer: VariantOffer; price: number } | null = null;
    for (const { offer, target } of rows) {
      const applies =
        target.variantId === variant.variantId ||
        target.productId === variant.productId ||
        target.categoryCode === variant.categoryCode;
      if (!applies) continue;
      const price = offerUnitPrice(variant.priceAgorot, offer);
      if (price === null || (best && best.price <= price)) continue;
      best = {
        price,
        offer: {
          offerId: offer.id,
          nameAr: offer.nameAr,
          displayText: offer.displayText,
          kind: offer.kind,
          value: offer.value,
          minQuantity: offer.minQuantity,
          endsAt: offer.endsAt?.toISOString() ?? null,
        },
      };
    }
    if (best) result.set(variant.variantId, best.offer);
  }
  return result;
}
