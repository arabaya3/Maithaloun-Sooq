import type { Metadata } from "next";
import { Suspense } from "react";

import { bestSellerIds } from "@/features/catalog/infrastructure/best-sellers";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";
import { StorefrontFromUrl } from "@/features/storefront/components/storefront-from-url";
import {
  bestSellers,
  catalogBrands,
  pickHeroProducts,
} from "@/features/storefront/domain/home-merchandising";
import { localizedAlternates } from "@/i18n/server";

// Unknown languages (scanner paths like /wp-login.php land here) are a static 404, never a render.
export const dynamicParams = false;

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
  return (
    <Suspense fallback={<Storefront {...props} />}>
      <StorefrontFromUrl {...props} />
    </Suspense>
  );
}
