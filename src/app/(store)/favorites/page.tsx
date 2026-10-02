import type { Metadata } from "next";
import { connection } from "next/server";

import { customerFavoritesService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { FavoritesView } from "@/features/favorites/favorites-view";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "المفضلة",
  robots: { index: false, follow: false },
};

export default async function FavoritesPage() {
  await connection();
  const [products, customer] = await Promise.all([
    productRepository.list(),
    getCustomerSession(),
  ]);
  const retiredNames = customer
    ? await customerFavoritesService.retiredNames(
        customer.id,
        new Set(products.map((product) => product.id)),
      )
    : [];

  return (
    <>
      <SiteHeader />
      <main className="page-shell favorites-page">
        <FavoritesView
          products={products}
          accountsEnabled={customerAccountsEnabled()}
          retiredNames={retiredNames}
        />
      </main>
      <MobileNavigation />
    </>
  );
}
