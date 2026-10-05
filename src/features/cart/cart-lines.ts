import {
  offerForSellingUnit,
  priceSellingUnit,
  type PricedUnit,
} from "@/features/catalog/domain/offer-pricing";
import type {
  Product,
  ProductVariant,
} from "@/features/catalog/domain/product";
import {
  isVariantAvailable,
  resolveVariant,
} from "@/features/catalog/domain/product-variant";
import {
  isSellingUnitPurchasable,
  type SellingUnit,
} from "@/features/catalog/domain/selling-unit";

import { calculateLineSubtotal, type CartLine } from "./cart-store";

// ok: counts in the total. review: its way of buying was archived or changed; the customer picks
// again. unavailable: cannot be bought now. limited: more requested than stock allows.
export type CartLineStatus = "ok" | "review" | "unavailable" | "limited";

export interface ResolvedCartLine {
  line: CartLine;
  product: Product;
  variant: ProductVariant;
  unit: SellingUnit | null;
  status: CartLineStatus;
  priced: PricedUnit | null;
  lineSubtotalAgorot: number | null;
  // Physical pieces this line takes from stock, e.g. 2 × 3-pack = 6.
  baseUnits: number | null;
}

export function resolveCartLines(
  lines: readonly CartLine[],
  productsById: ReadonlyMap<string, Product>,
): ResolvedCartLine[] {
  return lines.flatMap((line): ResolvedCartLine[] => {
    const product = productsById.get(line.productId);
    if (!product) return [];
    const variant = resolveVariant(product.variants, line.variantId);
    if (!variant || variant.id !== line.variantId) return [];
    const unit =
      variant.sellingUnits.find((entry) => entry.id === line.sellingUnitId) ??
      null;
    const status: CartLineStatus =
      !unit || unit.unitsPerSale !== line.unitsPerSale
        ? "review"
        : !isVariantAvailable(variant) || !isSellingUnitPurchasable(unit)
          ? "unavailable"
          : line.quantity > unit.maxQuantity
            ? "limited"
            : "ok";
    if (status !== "ok" || !unit) {
      return [
        {
          line,
          product,
          variant,
          unit: status === "review" ? null : unit,
          status,
          priced: null,
          lineSubtotalAgorot: null,
          baseUnits: null,
        },
      ];
    }
    const priced = priceSellingUnit(
      unit,
      offerForSellingUnit(unit, variant.offer),
      line.quantity,
    );
    return [
      {
        line,
        product,
        variant,
        unit,
        status,
        priced,
        lineSubtotalAgorot: calculateLineSubtotal(
          priced.unitPriceAgorot,
          line.quantity,
        ),
        baseUnits: line.quantity * unit.unitsPerSale,
      },
    ];
  });
}

export function cartMerchandiseSubtotal(lines: readonly ResolvedCartLine[]) {
  return lines.reduce(
    (total, line) => total + (line.lineSubtotalAgorot ?? 0),
    0,
  );
}
