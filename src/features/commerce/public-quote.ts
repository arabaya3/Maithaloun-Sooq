import { z } from "zod";

import { localizedProductName } from "@/features/catalog/domain/product";
import { formatVariantAttributes } from "@/features/catalog/domain/product-variant";
import { checkoutItemSchema } from "@/features/orders/domain/checkout-request";

export const MAX_QUOTE_ITEMS = 50;

export const quoteRequestSchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(MAX_QUOTE_ITEMS),
  })
  .strict();

export type QuoteRequest = z.output<typeof quoteRequestSchema>;

interface PricedLine {
  productId: string;
  variantId: string;
  quantity: number;
  product: {
    slug: string;
    nameAr: string;
    latinName: string | null;
    nameEn: string | null;
  };
  variant: { labelAr: string };
  unit: { id: string; labelAr: string; unitsPerSale: number };
  attributes: Parameters<typeof formatVariantAttributes>[0];
  priced: { unitPriceAgorot: number; listUnitPriceAgorot: number };
  lineSubtotalAgorot: number;
}

/** Turns the authoritative cart pricing into the public quote every channel shows. */
export function publicQuote(
  priced: {
    lines: readonly PricedLine[];
    itemsSubtotalAgorot: number;
    deliveryFeeAgorot: number;
    finalTotalAgorot: number;
  },
  locale: "ar" | "en",
) {
  return {
    lines: priced.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      sellingUnitId: line.unit.id,
      slug: line.product.slug,
      name: localizedProductName(
        {
          nameAr: line.product.nameAr,
          latinName: line.product.latinName ?? undefined,
          nameEn: line.product.nameEn ?? undefined,
        },
        locale,
      ),
      options: formatVariantAttributes(line.attributes) || null,
      unit: line.unit.unitsPerSale > 1 ? line.unit.labelAr : null,
      quantity: line.quantity,
      unitPriceAgorot: line.priced.unitPriceAgorot,
      listUnitPriceAgorot: line.priced.listUnitPriceAgorot,
      lineSubtotalAgorot: line.lineSubtotalAgorot,
    })),
    itemsSubtotalAgorot: priced.itemsSubtotalAgorot,
    deliveryFeeAgorot: priced.deliveryFeeAgorot,
    totalAgorot: priced.finalTotalAgorot,
  };
}

export type PublicQuote = ReturnType<typeof publicQuote>;
