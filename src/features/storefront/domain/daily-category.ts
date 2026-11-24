import {
  isInCategory,
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { compareNewest } from "@/features/catalog/domain/product-sort";
import { daysBetween, toStoreDate } from "@/shared/lib/store-time";

/** How many products the «today's category» showcase turns through. */
export const DAILY_CATEGORY_PHOTOS = 6;

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
