import { offerForSellingUnit, priceSellingUnit } from "./offer-pricing";
import type { Product } from "./product";
import { defaultSellingUnit } from "./selling-unit";

export const PRODUCT_SORTS = ["featured", "price-asc", "price-desc"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export function parseProductSort(
  value: string | null | undefined,
): ProductSort {
  return PRODUCT_SORTS.includes(value as ProductSort)
    ? (value as ProductSort)
    : "featured";
}

/** The one-piece price a product card shows, so sorting matches what shoppers see. */
export function cardPriceAgorot(product: Product): number {
  const variant = product.variants.find(
    (row) => row.id === product.defaultVariantId,
  );
  const unit = variant ? defaultSellingUnit(variant.sellingUnits) : null;
  if (!variant || !unit) return product.priceAgorot;
  return priceSellingUnit(unit, offerForSellingUnit(unit, variant.offer), 1)
    .unitPriceAgorot;
}

/** «featured» keeps the owner's order; price sorts are stable, so ties keep it too. */
export function sortProducts<T extends Product>(
  products: readonly T[],
  sort: ProductSort,
): T[] {
  if (sort === "featured") return [...products];
  const direction = sort === "price-asc" ? 1 : -1;
  return products
    .map((product, index) => ({
      product,
      index,
      price: cardPriceAgorot(product),
    }))
    .sort(
      (left, right) =>
        (left.price - right.price) * direction || left.index - right.index,
    )
    .map(({ product }) => product);
}
