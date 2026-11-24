import { offerForSellingUnit, priceSellingUnit } from "./offer-pricing";
import type { Product } from "./product";
import { defaultSellingUnit } from "./selling-unit";

export const PRODUCT_SORTS = [
  "newest",
  "featured",
  "price-asc",
  "price-desc",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** What every product list shows first unless the shopper picks another order. */
export const DEFAULT_PRODUCT_SORT: ProductSort = "newest";

export function parseProductSort(
  value: string | null | undefined,
): ProductSort {
  return PRODUCT_SORTS.includes(value as ProductSort)
    ? (value as ProductSort)
    : DEFAULT_PRODUCT_SORT;
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

function createdTime(product: Pick<Product, "createdAt">): number | null {
  if (!product.createdAt) return null;
  const time = Date.parse(product.createdAt);
  return Number.isFinite(time) ? time : null;
}

/**
 * Newest first by the product's original creation time (edits never move it), then by id so equal
 * times always come out in the same order. A product without a known time goes after dated ones.
 */
export function compareNewest(
  left: Pick<Product, "createdAt" | "id">,
  right: Pick<Product, "createdAt" | "id">,
): number {
  const a = createdTime(left);
  const b = createdTime(right);
  if (a !== b) {
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** «featured» keeps the owner's order; the other sorts are stable and total. */
export function sortProducts<T extends Product>(
  products: readonly T[],
  sort: ProductSort,
): T[] {
  if (sort === "featured") return [...products];
  if (sort === "newest") return [...products].sort(compareNewest);
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
