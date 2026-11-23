import { isInCategory, productCategoryCodes, type Product } from "./product";

export const MAX_EXTRA_CATEGORIES = 8;

/** The extra categories to store: unique, never the primary, at most MAX_EXTRA_CATEGORIES. */
export function normalizeExtraCategories(
  primary: string,
  extras: readonly string[],
): string[] {
  return [...new Set(extras.map((code) => code.trim()))]
    .filter((code) => code && code !== primary)
    .slice(0, MAX_EXTRA_CATEGORIES);
}

/** Products listed in a category, primary or extra; each product appears once. */
export function productsInCategory<T extends Product>(
  products: readonly T[],
  code: string,
): T[] {
  return products.filter((product) => isInCategory(product, code));
}

/** How many distinct products each category lists; a product counts once per category it is in. */
export function categoryProductCounts(
  products: readonly Pick<Product, "categoryId" | "categoryIds">[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const code of productCategoryCodes(product)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}
