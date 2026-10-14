import { connection } from "next/server";

import { ALL_CATEGORIES } from "@/features/catalog/domain/category";
import { bestSellerIds } from "@/features/catalog/infrastructure/best-sellers";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { parseProductSort } from "@/features/catalog/domain/product-sort";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";
import {
  bestSellers,
  catalogBrands,
  pickHeroProducts,
} from "@/features/storefront/domain/home-merchandising";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string | string[];
    q?: string | string[];
    sort?: string | string[];
  }>;
}) {
  await connection();
  const [products, categories, rankedIds, params] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    bestSellerIds(),
    searchParams,
  ]);
  // Unknown, hidden or archived codes fall back to every product.
  const initialCategory =
    categories.find((item) => item.code === first(params.category))?.code ??
    ALL_CATEGORIES;
  const initialQuery = (first(params.q) ?? "").slice(0, 100);
  return (
    <Storefront
      products={products}
      categories={categories}
      initialCategory={initialCategory}
      initialQuery={initialQuery}
      initialSort={parseProductSort(first(params.sort))}
      merchandising={{
        heroProducts: pickHeroProducts(products),
        brands: catalogBrands(products),
        bestSellers: bestSellers(products, rankedIds),
      }}
    />
  );
}
