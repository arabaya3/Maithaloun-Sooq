import {
  isInCategory,
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { compareNewest } from "@/features/catalog/domain/product-sort";
import { daysBetween, toStoreDate } from "@/shared/lib/store-time";

/** How many products the «today's category» scene can turn through in a day. */
export const DAILY_CATEGORY_PHOTOS = 12;

/** How many products stand together in the scene at once. */
export const DAILY_GROUP_SIZE = 3;

/**
 * Splits the banner's products into groups shown together. A product appears once at most, and
 * the groups are balanced (sizes differ by one at most) so no group is left with a lone product
 * while another is full. Order is kept: the newest products are in the first group.
 */
export function groupDailyProducts<P extends { id: string }>(
  products: readonly P[],
  size = DAILY_GROUP_SIZE,
): P[][] {
  const seen = new Set<string>();
  const distinct = products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
  if (!distinct.length) return [];
  const count = Math.ceil(distinct.length / Math.max(1, Math.trunc(size)));
  const base = Math.floor(distinct.length / count);
  const larger = distinct.length % count;
  const groups: P[][] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const length = base + (index < larger ? 1 : 0);
    groups.push(distinct.slice(start, start + length));
    start += length;
  }
  return groups;
}

/**
 * The store's calendar day (Asia/Hebron) as a whole number of days since 1970-01-01. Every visitor
 * gets the same number all day, whatever their device clock zone, and it changes at Hebron midnight.
 */
export function storeDayNumber(now: Date): number {
  return daysBetween("1970-01-01", toStoreDate(now));
}

interface RotatingCategory {
  code: string;
  sortOrder: number;
}

/**
 * The category for a given store day: published categories that list at least one product, in a
 * fixed order (the owner's sort order, then code), one per day, starting over after the last one.
 * Pure: the same inputs always give the same category; null when no category has products.
 */
export function pickDailyCategory<C extends RotatingCategory>(
  categories: readonly C[],
  products: readonly Pick<Product, "categoryId" | "categoryIds">[],
  dayNumber: number,
): C | null {
  const eligible = [...categories]
    .filter((category) =>
      products.some((product) => isInCategory(product, category.code)),
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        (left.code < right.code ? -1 : left.code > right.code ? 1 : 0),
    );
  if (!eligible.length) return null;
  const day = Math.trunc(dayNumber);
  const index = ((day % eligible.length) + eligible.length) % eligible.length;
  return eligible[index]!;
}

/** Real product photos from the category for the banner: available, photographed, newest first. */
export function dailyCategoryProducts(
  products: readonly Product[],
  code: string,
  limit = DAILY_CATEGORY_PHOTOS,
): Product[] {
  return products
    .filter(
      (product) =>
        isInCategory(product, code) &&
        product.image.kind === "image" &&
        isProductAvailable(product),
    )
    .sort(compareNewest)
    .slice(0, limit);
}
