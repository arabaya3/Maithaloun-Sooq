import type { Metadata } from "next";

import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { ProductListing } from "@/features/storefront/components/product-listing";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { newSince } from "@/features/storefront/domain/new-arrivals";
import { getMessages, localizedAlternates } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    alternates: await localizedAlternates("/products"),
    title: m.store.allProductsTitle,
  };
}

/** Every published product once, newest first, with sort and a category filter in the address. */
export default async function AllProductsPage() {
  const [products, categories] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
  ]);
  const m = await getMessages();
  return (
    <>
      <SiteHeader />
      <main className="page-shell categories-page all-products-page">
        <ProductListing
          products={products}
          categories={categories}
          newSince={newSince(new Date())}
          heading={<h1>{m.store.allProductsTitle}</h1>}
        />
      </main>
      <MobileNavigation />
    </>
  );
}
