import Image from "next/image";
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
import { getLocale, localizedAlternates } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await localizedAlternates("/") };
}

export default async function HomePage() {
  const [products, categories, rankedIds, locale] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    bestSellerIds(),
    getLocale(),
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
  const arabic = locale === "ar";
  return (
    <>
      <Storefront {...props} readFiltersFromUrl />
      <details className="home-meetho">
        <summary aria-label={arabic ? "ميثو" : "Meetho"}>
          <Image
            src="/meetho.svg"
            alt=""
            width={130}
            height={161}
            unoptimized
          />
        </summary>
        <p>{arabic ? "أهلًا فيك بميثا!" : "Welcome to MAYTHA!"}</p>
      </details>
    </>
  );
}
