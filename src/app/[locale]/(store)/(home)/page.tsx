import type { Metadata } from "next";

import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";
import {
  dailyCategoryProducts,
  pickDailyCategory,
  storeDayNumber,
} from "@/features/storefront/domain/daily-category";
import { newSince } from "@/features/storefront/domain/new-arrivals";
import { localizedAlternates } from "@/i18n/server";

// «Today's category» changes at midnight in Hebron. The page is re-rendered at least hourly, and the
// storefront-day cron (deploy/cron.txt) asks for a fresh render right after midnight, so the banner
// follows the store day without anything being computed in the browser.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await localizedAlternates("/") };
}

export default async function HomePage() {
  const [products, categories] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
  ]);
  const now = new Date();
  // Picked once on the server for the whole store day; the browser shows exactly this.
  const category = pickDailyCategory(categories, products, storeDayNumber(now));
  const daily = {
    code: category?.code ?? null,
    productIds: category
      ? dailyCategoryProducts(products, category.code).map(
          (product) => product.id,
        )
      : [],
  };
  // Cached for everyone; the address filters are applied in the browser.
  return (
    <Storefront
      products={products}
      categories={categories}
      daily={daily}
      newSince={newSince(now)}
      readFiltersFromUrl
    />
  );
}
