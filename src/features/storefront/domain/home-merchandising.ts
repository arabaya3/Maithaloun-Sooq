import type { ProductCategory } from "@/features/catalog/domain/category";
import {
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";

export interface CatalogBrand {
  name: string;
  productCount: number;
}

const hasPhoto = (product: Product) => product.image.kind === "image";

export function brandPath(name: string): string {
  return `/brands/${encodeURIComponent(name)}`;
}

/** Up to `limit` available products with real photos, one per category, branded ones first. */
export function pickHeroProducts(
  products: readonly Product[],
  limit = 3,
): Product[] {
  const candidates = products
    .filter((product) => hasPhoto(product) && isProductAvailable(product))
    .map((product, index) => ({ product, index }))
    .sort(
      (left, right) =>
        Number(Boolean(right.product.brand)) -
          Number(Boolean(left.product.brand)) || left.index - right.index,
    );
  const picked: Product[] = [];
  const categories = new Set<string>();
  for (const { product } of candidates) {
    if (categories.has(product.categoryId)) continue;
    categories.add(product.categoryId);
    picked.push(product);
    if (picked.length === limit) break;
  }
  return picked;
}

/** Brands as the owner entered them, most stocked first; names are never derived from product titles. */
export function catalogBrands(products: readonly Product[]): CatalogBrand[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const name = product.brand?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, productCount]) => ({ name, productCount }))
    .sort(
      (left, right) =>
        right.productCount - left.productCount ||
        left.name.localeCompare(right.name),
    );
}

/** Keeps the ranking from real orders and drops anything no longer on sale. */
export function bestSellers(
  products: readonly Product[],
  rankedIds: readonly string[],
  limit = 8,
): Product[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  return rankedIds
    .map((id) => byId.get(id))
    .filter(
      (product): product is Product =>
        Boolean(product) && isProductAvailable(product!),
    )
    .slice(0, limit);
}

export function productsOnOffer(products: readonly Product[]): Product[] {
  return products.filter(
    (product) =>
      isProductAvailable(product) &&
      product.variants.some((variant) => Boolean(variant.offer)),
  );
}

/** The visible category with the most products, for the second promotion. */
export function featuredCategory(
  products: readonly Product[],
  categories: readonly ProductCategory[],
): { category: ProductCategory; product: Product | null } | null {
  let best: { category: ProductCategory; count: number } | null = null;
  for (const category of categories) {
    const count = products.filter(
      (product) => product.categoryId === category.code,
    ).length;
    if (count > 0 && (!best || count > best.count)) best = { category, count };
  }
  if (!best) return null;
  const code = best.category.code;
  return {
    category: best.category,
    product:
      products.find(
        (product) => product.categoryId === code && hasPhoto(product),
      ) ?? null,
  };
}
