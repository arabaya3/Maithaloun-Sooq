import type { Metadata } from "next";

import { bestSellerIds } from "@/features/catalog/infrastructure/best-sellers";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";
import {
  bestSellers,
  catalogBrands,
  pickHeroProducts,
} from "@/features/storefront/domain/home-merchandising";
import { localizedAlternates } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await localizedAlternates("/") };
}

export default async function HomePage() {
  const [products, categories, rankedIds] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    bestSellerIds(),
  ]);
  const props = {
    products,
    categories,
    merchandising: {
      heroProducts: pickHeroProducts(products),
      brands: catalogBrands(products),
      bestSellers: bestSellers(products, rankedIds),
    },
  };
  // Cached for everyone; the address filters are applied in the browser.
  return (
    <>
      <Storefront {...props} readFiltersFromUrl />
    </>
  );
}
